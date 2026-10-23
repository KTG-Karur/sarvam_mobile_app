'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { OnboardingOrgPicker, type OnboardingOrgValue } from './OnboardingOrgPicker';
import {
    UserPlus, Plus, CheckCircle2, XCircle, Undo2, Eye, Copy, KeyRound, Link2, Send,
    MessageCircle, Mail, ArrowLeft, ChevronLeft, ChevronRight, Save, AlertTriangle, Loader2, Trash2, IdCard, X, Clock, Search,
} from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import { useHrOnboardingValidation } from '@/hooks/useHrOnboardingValidation';
import { usePermission } from '@/app/hooks/usePermission';
import { hasReportingHierarchy } from '@/app/lib/hr/reporting-hierarchy';
import {
    OnboardingRequestForm, emptyOnboardingFormValues, toOnboardingApiPayload, SECTIONS,
    type OnboardingFormValues, type OnboardingFormLookups, type ChildEntry, type SectionId,
} from '@/components/hr/OnboardingRequestForm';
import { OnboardingDocumentUploader } from '@/components/hr/OnboardingDocumentUploader';
import { EmployeeIdCardModal, type IdCardData } from '@/components/hr/EmployeeIdCardModal';
import { validateOnboardingForm, validateSingleField, getSectionForField, clearChildAadhaarErrors } from '@/app/lib/hr/onboarding-validation-rules';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';
import { useEmployeeIdCard } from '@/components/hr/useEmployeeIdCard';

// ─── Types ──────────────────────────────────────────────────────
interface OnboardingRow {
    id: string;
    employeeName: string | null;
    status: string;
    source: string;
    branch: { name: string } | null;
    region?: { name: string } | null;
    division?: { name: string } | null;
    shift?: { name: string } | null;
    department: { name: string } | null;
    designation: { name: string } | null;
    createdBy: { firstName: string; lastName: string } | null;
    createdUser: { id: string; employeeId: string | null } | null;
    createdAt: string;
}
interface WorkflowStage {
    stageId: string; stageName: string; stageOrder: number;
    approverRoleSlug: string; status: string; remarks: string | null;
}
interface WorkflowStatus {
    instance: { currentStageId: string | null; status: string };
    stages: WorkflowStage[];
}
interface LookupRow { id: string; name: string }

// The full row fetched for the Detail view's Documents tab — every scalar
// field on EmployeeOnboardingRequest that the "personal / bank / everything"
// read-only summary renders (see DetailInfoSections below).
type DetailRequest = OnboardingRow & {
    branchId?: string | null;
    regionId?: string | null;
    divisionId?: string | null;
    shiftId?: string | null;
    rejectionReason?: string | null;
    designationId?: string | null;
    departmentId?: string | null;
    reportingManagerId?: string | null;
    dateOfJoining?: string | null;
    bloodGroup?: string | null;
    emergencyContactName?: string | null;
    emergencyContactRelation?: string | null;
    emergencyContactNumber?: string | null;
    mobileNumber?: string | null;
    generatedEmployeeId?: string | null;
    email?: string | null;
    currentAddress?: string | null;
    permanentAddress?: string | null;
    dateOfBirth?: string | null;
    gender?: string | null;
    maritalStatus?: string | null;
    educationQualification?: string | null;
    aadhaarNumber?: string | null;
    panNumber?: string | null;
    dlNumber?: string | null;
    voterIdNumber?: string | null;
    uanNumber?: string | null;
    esiNumber?: string | null;
    bankName?: string | null;
    bankBranchName?: string | null;
    accountNumber?: string | null;
    ifscCode?: string | null;
    insuranceCompanyName?: string | null;
    insurancePolicyNumber?: string | null;
    insuranceValidFrom?: string | null;
    insuranceValidTo?: string | null;
    fatherName?: string | null;
    fatherAge?: number | null;
    fatherAadhaarNumber?: string | null;
    motherName?: string | null;
    motherAge?: number | null;
    motherAadhaarNumber?: string | null;
    wifeName?: string | null;
    wifeAge?: number | null;
    wifeAadhaarNumber?: string | null;
    wifeBankAccountNumber?: string | null;
    wifeIfscCode?: string | null;
    wifeContactNumber?: string | null;
    husbandName?: string | null;
    husbandAge?: number | null;
    husbandAadhaarNumber?: string | null;
    husbandBankAccountNumber?: string | null;
    husbandIfscCode?: string | null;
    husbandContactNumber?: string | null;
    weddingDate?: string | null;
    children?: { gender: string; age: number | string; aadhaarNumber: string }[] | null;
};

function fmtDate(value?: string | null): string {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : toDisplayDate(d);
}

function toDateInputValue(value?: string | null): string {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
}
function str(value?: string | number | null): string {
    return value === null || value === undefined ? '' : String(value);
}

// Maps the read-only detail row back into the editable form's all-strings
// shape — used to seed the step-by-step form when a DRAFT request is opened
// for filling (openDraft) with the request's current values.
// branchId/designationId/departmentId/reportingManagerId/dateOfJoining are
// deliberately left blank: those are set by the dedicated branch picker and
// the Finalize panel respectively, and toOnboardingApiPayload's blanks
// normalize to "leave unchanged" server side, so this form can never
// clobber them.
function detailRequestToFormValues(request: DetailRequest): OnboardingFormValues {
    return {
        employeeName: str(request.employeeName), branchId: '', regionId: str(request.regionId), divisionId: str(request.divisionId), shiftId: str(request.shiftId), designationId: '', departmentId: '',
        educationQualification: str(request.educationQualification), mobileNumber: str(request.mobileNumber),
        email: str(request.email), currentAddress: str(request.currentAddress), permanentAddress: str(request.permanentAddress),
        dateOfBirth: toDateInputValue(request.dateOfBirth), gender: str(request.gender), maritalStatus: str(request.maritalStatus),
        emergencyContactName: str(request.emergencyContactName), emergencyContactRelation: str(request.emergencyContactRelation), emergencyContactNumber: str(request.emergencyContactNumber),
        bloodGroup: str(request.bloodGroup), aadhaarNumber: str(request.aadhaarNumber), panNumber: str(request.panNumber),
        dlNumber: str(request.dlNumber), voterIdNumber: str(request.voterIdNumber), uanNumber: str(request.uanNumber),
        esiNumber: str(request.esiNumber), bankName: str(request.bankName), bankBranchName: str(request.bankBranchName), accountNumber: str(request.accountNumber),
        ifscCode: str(request.ifscCode), reportingManagerId: '', dateOfJoining: '',
        insuranceCompanyName: str(request.insuranceCompanyName), insurancePolicyNumber: str(request.insurancePolicyNumber),
        insuranceValidFrom: toDateInputValue(request.insuranceValidFrom), insuranceValidTo: toDateInputValue(request.insuranceValidTo),
        fatherName: str(request.fatherName), fatherAge: str(request.fatherAge), fatherAadhaarNumber: str(request.fatherAadhaarNumber),
        motherName: str(request.motherName), motherAge: str(request.motherAge), motherAadhaarNumber: str(request.motherAadhaarNumber),
        wifeName: str(request.wifeName), wifeAge: str(request.wifeAge), wifeAadhaarNumber: str(request.wifeAadhaarNumber),
        wifeBankAccountNumber: str(request.wifeBankAccountNumber), wifeIfscCode: str(request.wifeIfscCode),
        wifeContactNumber: str(request.wifeContactNumber),
        husbandName: str(request.husbandName), husbandAge: str(request.husbandAge), husbandAadhaarNumber: str(request.husbandAadhaarNumber),
        husbandBankAccountNumber: str(request.husbandBankAccountNumber), husbandIfscCode: str(request.husbandIfscCode),
        husbandContactNumber: str(request.husbandContactNumber),
        weddingDate: toDateInputValue(request.weddingDate),
        children: (request.children ?? []).map((c) => ({ gender: c.gender || '', age: str(c.age), aadhaarNumber: c.aadhaarNumber || '' })),
    };
}

// One label/value pair in the Documents tab's read-only details summary —
// skips rendering entirely when there's nothing to show, so empty optional
// fields don't clutter the grid.
function DetailField({ label, value }: { label: string; value?: string | number | null }) {
    if (value === null || value === undefined || value === '') return null;
    return (
        <div>
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-sm font-medium break-words">{value}</p>
        </div>
    );
}

// The full "personal details, bank details, everything" read-only summary
// shown at the top of the Documents tab — mirrors OnboardingRequestForm's
// section layout/labels so HR sees the same terminology they filled in.
function DetailInfoSections({ request }: { request: DetailRequest }) {
    // Same rule as the intake form: spouse details/Wedding Date/Children only
    // for a currently married applicant (Single, Divorced and Widowed hide them).
    const isMarried = request.maritalStatus === 'MARRIED';
    const isMale = request.gender === 'MALE';
    const isFemale = request.gender === 'FEMALE';
    const showWifeFields = isMarried && isMale;
    const showHusbandFields = isMarried && isFemale;
    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Personal Details</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    <DetailField label="Employee Name" value={request.employeeName} />
                    <DetailField label="Region" value={request.region?.name} />
                    <DetailField label="Division" value={request.division?.name} />
                    <DetailField label="Shift" value={request.shift?.name} />
                    <DetailField label="Mobile Number" value={request.mobileNumber} />
                    <DetailField label="Email ID" value={request.email} />
                    <DetailField label="Date of Birth" value={fmtDate(request.dateOfBirth)} />
                    <DetailField label="Gender" value={request.gender} />
                    <DetailField label="Marital Status" value={request.maritalStatus} />
                    <DetailField label="Blood Group" value={request.bloodGroup} />
                    <DetailField label="Education Qualification" value={request.educationQualification} />
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Address</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    <DetailField label="Current Address" value={request.currentAddress} />
                    <DetailField label="Permanent Address" value={request.permanentAddress} />
                    <DetailField label="Emergency Contact Name" value={request.emergencyContactName} />
                    <DetailField label="Emergency Contact Relationship" value={request.emergencyContactRelation} />
                    <DetailField label="Emergency Contact Number" value={request.emergencyContactNumber} />
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Identity &amp; Statutory Details</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    <DetailField label="Aadhaar Number" value={request.aadhaarNumber} />
                    <DetailField label="PAN Number" value={request.panNumber} />
                    <DetailField label="DL & LLR Number" value={request.dlNumber} />
                    <DetailField label="Voter ID Number" value={request.voterIdNumber} />
                    <DetailField label="UAN Number" value={request.uanNumber} />
                    <DetailField label="ESI Number" value={request.esiNumber} />
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Bank Details</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    <DetailField label="Bank Name" value={request.bankName} />
                    <DetailField label="Bank Branch Name" value={request.bankBranchName} />
                    <DetailField label="Account Number" value={request.accountNumber} />
                    <DetailField label="IFSC Code" value={request.ifscCode} />
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Vehicle Insurance</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    <DetailField label="Insurance Company Name" value={request.insuranceCompanyName} />
                    <DetailField label="Insurance Policy Number" value={request.insurancePolicyNumber} />
                    <DetailField label="Valid From" value={fmtDate(request.insuranceValidFrom)} />
                    <DetailField label="Valid To" value={fmtDate(request.insuranceValidTo)} />
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Family Details</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    <DetailField label="Father Name" value={request.fatherName} />
                    <DetailField label="Father Age" value={request.fatherAge} />
                    <DetailField label="Father Aadhaar Number" value={request.fatherAadhaarNumber} />
                    <DetailField label="Mother Name" value={request.motherName} />
                    <DetailField label="Mother Age" value={request.motherAge} />
                    <DetailField label="Mother Aadhaar Number" value={request.motherAadhaarNumber} />
                    {showWifeFields && (
                        <>
                            <DetailField label="Spouse Name" value={request.wifeName} />
                            <DetailField label="Spouse Age" value={request.wifeAge} />
                            <DetailField label="Spouse Aadhaar Number" value={request.wifeAadhaarNumber} />
                            <DetailField label="Spouse Bank Account Number" value={request.wifeBankAccountNumber} />
                            <DetailField label="Spouse IFSC Code" value={request.wifeIfscCode} />
                            <DetailField label="Spouse Contact Number" value={request.wifeContactNumber} />
                            <DetailField label="Wedding Date" value={fmtDate(request.weddingDate)} />
                        </>
                    )}
                    {showHusbandFields && (
                        <>
                            <DetailField label="Spouse Name" value={request.husbandName} />
                            <DetailField label="Spouse Age" value={request.husbandAge} />
                            <DetailField label="Spouse Aadhaar Number" value={request.husbandAadhaarNumber} />
                            <DetailField label="Spouse Bank Account Number" value={request.husbandBankAccountNumber} />
                            <DetailField label="Spouse IFSC Code" value={request.husbandIfscCode} />
                            <DetailField label="Spouse Contact Number" value={request.husbandContactNumber} />
                            <DetailField label="Wedding Date" value={fmtDate(request.weddingDate)} />
                        </>
                    )}
                    {isMarried && !showWifeFields && !showHusbandFields && (
                        <DetailField label="Wedding Date" value={fmtDate(request.weddingDate)} />
                    )}
                </CardContent>
                {isMarried && !!request.children?.length && (
                    <CardContent className="pt-0">
                        <p className="text-xs text-gray-500 mb-1.5">Children</p>
                        <ul className="space-y-1">
                            {request.children.map((child, i) => (
                                <li key={i} className="text-sm">
                                    {child.gender || '—'}, Age {child.age || '—'}, Aadhaar {child.aadhaarNumber || '—'}
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                )}
            </Card>
        </div>
    );
}

function statusVariant(status: string): 'default' | 'destructive' | 'outline' | 'secondary' {
    if (status === 'APPROVED') return 'default';
    if (status === 'REJECTED') return 'destructive';
    if (status === 'PENDING_APPROVAL' || status === 'IN_PROGRESS') return 'secondary';
    return 'outline';
}

// Mirrors the server-side check in DELETE /api/hr/onboarding/[id] — deleting
// a request mid-approval or already-provisioned would orphan an in-flight
// ApprovalInstance or, worse, a request that already produced a real User.
function canDelete(row: OnboardingRow): boolean {
    return ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'REJECTED'].includes(row.status);
}

function formatExpiryDate(dateStr: string): string {
    const d = new Date(dateStr);
    return new Intl.DateTimeFormat('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    })
        .format(d)
        .replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
}

function formatLiveExpiryHint(days: number, hours: number): string {
    const total = days * 24 + hours;
    if (total < 1) return 'Pick at least 1 hour';
    if (total > 720) return 'Max 30 days (720 hours)';

    const parts: string[] = [];
    if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
    if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);

    return `Expires in ${parts.join(' ')}`;
}

// The just-created login is shown exactly once — it's hashed in the DB the
// moment the account is created, so if the browser reloads before an admin
// copies it down there is no way to recover it, ever, short of DB surgery.
// Mirrored into sessionStorage the instant it's shown so an accidental
// refresh (this whole component's view/detailId/credentials are otherwise
// plain in-memory state, wiped on reload) can restore the same reveal panel
// instead of silently losing the password. Cleared the moment the admin
// leaves the detail view (closeDetailView) — same lifetime the on-screen
// reveal already has today.
const PENDING_CREDENTIALS_KEY = 'hr-onboarding-pending-credentials';

type PendingCredentials = { requestId: string; employeeId: string; temporaryPassword: string };

interface RejoinerHint {
    field: string;
    employeeId: string | null;
    name: string;
    dateOfExit: string | null;
}

export function OnboardingQueueClient() {
    const { toast } = useToast();
    const router = useRouter();
    const [rows, setRows] = useState<OnboardingRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const [lookups, setLookups] = useState<OnboardingFormLookups>({ branches: [], departments: [], designations: [], managers: [] });

    // "list" = the queue table; "create"/"detail" take over the full content
    // area (no modal) until the user finishes, cancels, or goes back — the
    // Documents tab's tile grid needs real page width, not a ~560px dialog.
    const [view, setView] = useState<'list' | 'create' | 'detail'>('list');
    const [formValues, setFormValues] = useState<OnboardingFormValues>(emptyOnboardingFormValues());
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [activeSection, setActiveSection] = useState<SectionId>('personal');
    const [creating, setCreating] = useState(false);
    const [savingDraft, setSavingDraft] = useState(false);
    // Set once the current manual entry has been saved at least once (via
    // Save Draft or Create Request) — subsequent saves update that same
    // request instead of creating a duplicate row every time.
    const [draftId, setDraftId] = useState<string | null>(null);
    // True when the create view was opened from an existing DRAFT row (see
    // openDraft) instead of the "New Employee" button — same step-by-step
    // form as Manual Entry, just seeded with the draft's saved values and
    // bound to that request's id, with no Generate Link tab.
    const [fillingDraft, setFillingDraft] = useState(false);
    const [openingDraftId, setOpeningDraftId] = useState<string | null>(null);
    const [generatingLink, setGeneratingLink] = useState(false);
    const [generatedLink, setGeneratedLink] = useState<string | null>(null);
    // Region / Division / Shift chosen for a Generate Link request (Manual Entry keeps them in formValues).
    const [linkOrg, setLinkOrg] = useState<OnboardingOrgValue>({ regionId: '', divisionId: '', shiftId: '' });
    const [linkExpiryDays, setLinkExpiryDays] = useState<number>(7);
    const [linkExpiryHours, setLinkExpiryHours] = useState<number>(0);
    const [generatedLinkExpiry, setGeneratedLinkExpiry] = useState<string | null>(null);
    // True while auto-saving a draft the moment the user opens the Documents
    // tab without having saved yet (Documents needs a real request id to
    // attach uploads to — see the activeSection effect below).
    const [draftCreating, setDraftCreating] = useState(false);

    // Deletable only before a decision is in flight or an employee has
    // already been provisioned — mirrors the server-side check exactly.
    const [deleteTarget, setDeleteTarget] = useState<OnboardingRow | null>(null);
    const [deleting, setDeleting] = useState(false);

    const [detailId, setDetailId] = useState<string | null>(null);
    const [detailRow, setDetailRow] = useState<DetailRequest | null>(null);
    const [detailWorkflow, setDetailWorkflow] = useState<WorkflowStatus | null>(null);
    const [actionRemarks, setActionRemarks] = useState('');
    const [acting, setActing] = useState(false);
    // userId: the just-provisioned User, so "Preview ID Card" reads the live record.
    const [credentials, setCredentials] = useState<{ employeeId: string; temporaryPassword: string; userId?: string } | null>(null);
    // Informational-only "possible rejoiner" signal — never blocks, never
    // affects Approve gating. rejoinerRowId is undefined while resolving,
    // null once resolution fails (banner still shows, just without a link).
    const [rejoinerHint, setRejoinerHint] = useState<RejoinerHint | null>(null);
    const [rejoinerRowId, setRejoinerRowId] = useState<string | null | undefined>(undefined);
    const [rejoinerDismissed, setRejoinerDismissed] = useState(false);
    const [idCardOpen, setIdCardOpen] = useState(false);
    const [idCardData, setIdCardData] = useState<IdCardData | null>(null);
    const cardRequestIdRef = useRef<string | null>(null);
    const { openForEmployee, loadingFor: loadingIdCardFor, dialogs: liveIdCardDialogs } = useEmployeeIdCard();
    // Branch is picked here, at Submit for Approval — not at Generate Link or
    // manual-entry creation — so ApprovalInstance.branchId (which the engine
    // requires to scope Stage 1's Branch Manager review) is set the moment the
    // workflow actually starts, without asking for it any earlier than needed.
    const [submitBranchId, setSubmitBranchId] = useState('');
    // Extra branches for a multi-branch role (Area Manager / Division
    // Manager) — the primary branch above stays the single source for
    // ApprovalInstance.branchId; these are additive, created as non-primary
    // AreaManagerBranch/UserBranchAssignment rows once the User is
    // provisioned (see the final-approve action route).
    const [additionalBranchIds, setAdditionalBranchIds] = useState<string[]>([]);
    const { isHeadOffice, branchAccess } = usePermission();

    // Table filters
    const [filterSearch, setFilterSearch] = useState('');
    const [filterBranchId, setFilterBranchId] = useState('ALL');
    const [filterDepartmentId, setFilterDepartmentId] = useState('ALL');
    const [filterStatus, setFilterStatus] = useState('ALL');

    // Table pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);


    // Correcting a mis-picked branch on an already-submitted request (only
    // while Stage 1 is still undecided — see canChangeBranch below).
    const [editingBranch, setEditingBranch] = useState(false);
    const [newBranchId, setNewBranchId] = useState('');
    const [changingBranch, setChangingBranch] = useState(false);

    // ── Finalize Employee Details — only relevant on the workflow's LAST
    // stage, collected here instead of at initial submission (see plan). ──
    const [finalizeDesignationId, setFinalizeDesignationId] = useState('');
    const [finalizeDepartmentId, setFinalizeDepartmentId] = useState('');
    const [finalizeManagerId, setFinalizeManagerId] = useState('');
    // Reporting Manager only means something when the configured
    // hr-onboarding approval workflow has more than one stage — a single
    // "Admin Approval" stage has no real reporting hierarchy to capture.
    const [approvalStageCount, setApprovalStageCount] = useState<number | null>(null);
    const showReportingManagerField = hasReportingHierarchy(approvalStageCount);
    const [finalizeDateOfJoining, setFinalizeDateOfJoining] = useState('');
    const [finalizeEmployeeId, setFinalizeEmployeeId] = useState('');
    const [finalizePassword, setFinalizePassword] = useState('');
    const [finalizeMonthlyCtc, setFinalizeMonthlyCtc] = useState('');
    const { isRequired: isOrgFieldRequired } = useHrOnboardingValidation();

    const fetchRows = useCallback(async () => {
        try {
            const res = await apiClient.get<OnboardingRow[]>('/hr/onboarding');
            if (res.success && res.data) setRows(res.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch onboarding requests.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    const fetchLookups = useCallback(async () => {
        const [branchesRes, departmentsRes, designationsRes, managersRes, approvalLevelsRes] = await Promise.all([
            apiClient.get<LookupRow[]>('/branches'),
            apiClient.get<LookupRow[]>('/hr/departments'),
            apiClient.get<LookupRow[]>('/hr/designations'),
            apiClient.get<{ id: string; firstName: string; lastName: string; employeeId: string | null }[]>('/hr/employees'),
            apiClient.get<{ stageCount: number }>('/hr/onboarding/approval-levels'),
        ]);
        setLookups({
            branches: branchesRes.data?.map((b) => ({ id: b.id, label: b.name })) ?? [],
            departments: departmentsRes.data?.map((d) => ({ id: d.id, label: d.name })) ?? [],
            designations: designationsRes.data?.map((d) => ({ id: d.id, label: d.name })) ?? [],
            managers: managersRes.data?.map((m) => ({ id: m.id, label: `${m.firstName} ${m.lastName}${m.employeeId ? ` (${m.employeeId})` : ''}` })) ?? [],
        });
        if (approvalLevelsRes.success && approvalLevelsRes.data) {
            setApprovalStageCount(approvalLevelsRes.data.stageCount);
        }
    }, []);

    useEffect(() => { fetchRows(); fetchLookups(); }, [fetchRows, fetchLookups]);

    // Applies a rejoinerHint carried on any HR-internal onboarding response
    // (create/update/submit-for-approval/action) — never called for the
    // public route, which never includes this field at all.
    const applyRejoinerHint = (hint: RejoinerHint | null | undefined) => {
        if (!hint) return;
        setRejoinerHint(hint);
        setRejoinerDismissed(false);
    };

    // Resolves rejoinerHint.employeeId (a human-readable EMP-ID) to the real
    // row id needed for the "View old record" deep link, via the existing
    // employee lookup by EMP-ID — never fails the flow: an unresolved lookup
    // just renders the hint as plain text with no link.
    useEffect(() => {
        if (!rejoinerHint?.employeeId) {
            setRejoinerRowId(null);
            return;
        }
        let cancelled = false;
        setRejoinerRowId(undefined);
        apiClient
            .get<{ id: string; employeeId: string | null }[]>(`/hr/employees?search=${encodeURIComponent(rejoinerHint.employeeId)}`)
            .then((res) => {
                if (cancelled) return;
                const match = res.success ? res.data?.find((e) => e.employeeId === rejoinerHint.employeeId) : undefined;
                setRejoinerRowId(match?.id ?? null);
            })
            .catch(() => {
                if (!cancelled) setRejoinerRowId(null);
            });
        return () => { cancelled = true; };
    }, [rejoinerHint]);

    // Restore a shown-once credentials reveal that survived a reload — see
    // PENDING_CREDENTIALS_KEY above. Deliberately does NOT reuse openDetail
    // (it resets credentials/finalize-field state to blank defaults, which
    // would immediately wipe the very thing this is trying to restore).
    useEffect(() => {
        const raw = sessionStorage.getItem(PENDING_CREDENTIALS_KEY);
        if (!raw) return;
        try {
            const saved = JSON.parse(raw) as PendingCredentials;
            setDetailId(saved.requestId);
            setView('detail');
            setCredentials({ employeeId: saved.employeeId, temporaryPassword: saved.temporaryPassword });
            apiClient.get<{ request: DetailRequest }>(`/hr/onboarding/${saved.requestId}`).then((res) => {
                if (res.success && res.data) setDetailRow(res.data.request);
            });
        } catch {
            sessionStorage.removeItem(PENDING_CREDENTIALS_KEY);
        }
        // Mount-only: this is a one-time reload recovery, not something that
        // should re-run as other state changes.
    }, []);

    const handleFormChange = (field: keyof OnboardingFormValues, value: string) => {
        setFormValues((prev) => ({ ...prev, [field]: value }));
        if (fieldErrors[field]) {
            setFieldErrors((prev) => {
                const next = { ...prev };
                delete next[field];
                return next;
            });
        }
    };
    const handleChildrenChange = (children: ChildEntry[]) => {
        const previousChildren = formValues.children;
        setFormValues((prev) => ({ ...prev, children }));
        setFieldErrors((prev) => clearChildAadhaarErrors(prev, previousChildren, children));
    };

    const handleFieldBlur = (field: keyof OnboardingFormValues) => {
        const isReq = isOrgFieldRequired(field);
        const err = validateSingleField(field, formValues[field], formValues, isReq);
        setFieldErrors((prev) => {
            if (err) {
                return { ...prev, [field]: err };
            }
            if (prev[field]) {
                const next = { ...prev };
                delete next[field];
                return next;
            }
            return prev;
        });
    };

    // Creates the request on first save, then updates that same row on every
    // save after — shared by "Save Draft", the auto-save that fires when the
    // Documents tab is opened, and the final "Create Request". `finalize`
    // is the only thing that ever advances a request out of DRAFT — every
    // other call here (however many times it runs) leaves it alone, so an
    // incidental autosave never shows up in the review queue as a
    // misleading "SUBMITTED" request with nothing actually filled in.
    const persistDraft = async (finalize = false): Promise<{ id: string; rejoinerHint: RejoinerHint | null }> => {
        if (draftId) {
            const res = await apiClient.patch<{ rejoinerHint?: RejoinerHint | null }>(`/hr/onboarding/${draftId}`, { ...toOnboardingApiPayload(formValues), finalize });
            if (!res.success) throw new Error(res.error || 'Failed to save');
            const hint = res.data?.rejoinerHint ?? null;
            applyRejoinerHint(hint);
            return { id: draftId, rejoinerHint: hint };
        }
        const res = await apiClient.post<{ id: string; rejoinerHint?: RejoinerHint | null }>('/hr/onboarding', { source: 'MANUAL', ...toOnboardingApiPayload(formValues), finalize });
        if (!res.success || !res.data) throw new Error(res.error || 'Failed to save');
        setDraftId(res.data.id);
        const hint = res.data.rejoinerHint ?? null;
        applyRejoinerHint(hint);
        return { id: res.data.id, rejoinerHint: hint };
    };

    const handleSaveDraft = async () => {
        // In draft mode, empty fields are allowed, but non-empty values must have valid format
        const validationErrors = validateOnboardingForm(formValues, isOrgFieldRequired, false);
        if (Object.keys(validationErrors).length > 0) {
            setFieldErrors(validationErrors);
            const firstErrorKey = Object.keys(validationErrors)[0];
            const targetSection = getSectionForField(firstErrorKey);
            if (targetSection) setActiveSection(targetSection);
            toast({
                title: 'Invalid values in draft',
                description: 'Please correct the highlighted field errors before saving.',
                variant: 'destructive',
            });
            return;
        }

        setSavingDraft(true);
        try {
            await persistDraft(false);
            setFieldErrors({});
            toast({ title: 'Draft saved', description: 'Come back anytime to finish or submit it for approval.' });
            await fetchRows();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to save draft.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setSavingDraft(false);
        }
    };

    const handleCreate = async () => {
        // For final submission, required fields and format rules are strictly checked
        const validationErrors = validateOnboardingForm(formValues, isOrgFieldRequired, true);
        if (Object.keys(validationErrors).length > 0) {
            setFieldErrors(validationErrors);
            const firstErrorKey = Object.keys(validationErrors)[0];
            const targetSection = getSectionForField(firstErrorKey);
            if (targetSection) setActiveSection(targetSection);
            toast({
                title: 'Please correct the highlighted fields',
                description: 'Some required fields are missing or contain invalid formats.',
                variant: 'destructive',
            });
            return;
        }

        setCreating(true);
        try {
            const { rejoinerHint: hint } = await persistDraft(true);
            setFieldErrors({});
            toast({ title: 'Created', description: 'Onboarding request created. Submit it for approval when ready.' });
            // A rejoiner hint is informational only, but closing straight
            // back to the list would throw away the one place it can be
            // shown — stay on this view so the admin actually sees it.
            if (hint) {
                await fetchRows();
            } else {
                closeCreateView();
                await fetchRows();
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to create request.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setCreating(false);
        }
    };

    // The Documents tab needs a real request id to attach uploads to — if the
    // user clicks straight to it without ever hitting Save Draft, auto-save
    // once (same call Save Draft already makes; every field is optional
    // server-side, so an early/incomplete save here is safe).
    useEffect(() => {
        if (view !== 'create' || activeSection !== 'documents' || draftId || draftCreating) return;
        setDraftCreating(true);
        persistDraft()
            .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : 'Failed to start draft.';
                toast({ title: 'Error', description: message, variant: 'destructive' });
            })
            .finally(() => setDraftCreating(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, activeSection, draftId, draftCreating]);

    // Note: Existing/generated links cannot be extended or edited afterward (expiry is set at creation; no edit endpoint).
    const handleGenerateLink = async () => {
        const total = linkExpiryDays * 24 + linkExpiryHours;
        if (total < 1 || total > 720) return;
        setGeneratingLink(true);
        try {
            const clampedHours = Math.min(720, Math.max(1, total));
            const res = await apiClient.post<{ request: { tokenExpiresAt: string }; publicUrl: string }>('/hr/onboarding', {
                source: 'LINK',
                tokenExpiryHours: clampedHours,
                ...(linkOrg.regionId ? { regionId: linkOrg.regionId } : {}),
                ...(linkOrg.divisionId ? { divisionId: linkOrg.divisionId } : {}),
                ...(linkOrg.shiftId ? { shiftId: linkOrg.shiftId } : {}),
            });
            if (res.success && res.data) {
                setGeneratedLink(res.data.publicUrl);
                setGeneratedLinkExpiry(res.data.request?.tokenExpiresAt ?? null);
                await fetchRows();
            } else {
                throw new Error(res.error || 'Failed to generate link');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to generate link.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setGeneratingLink(false);
        }
    };

    const copyLink = () => {
        if (!generatedLink) return;
        navigator.clipboard.writeText(generatedLink);
        toast({ title: 'Link copied to clipboard' });
    };

    const closeCreateView = () => {
        setView('list');
        setGeneratedLink(null);
        setGeneratedLinkExpiry(null);
        setLinkOrg({ regionId: '', divisionId: '', shiftId: '' });
        setLinkExpiryDays(7);
        setLinkExpiryHours(0);
        setDraftCreating(false);
        setFormValues(emptyOnboardingFormValues());
        setFieldErrors({});
        setActiveSection('personal');
        setDraftId(null);
        setFillingDraft(false);
        setRejoinerHint(null);
    };

    // Opens an existing DRAFT (a Generate-Link request nobody has filled in
    // yet, or a Manual Entry the admin saved and left) in the same
    // step-by-step form as Manual Entry — Save Draft / Create Request then
    // update that same row via persistDraft's draftId path.
    const openDraft = async (row: OnboardingRow) => {
        setOpeningDraftId(row.id);
        try {
            const res = await apiClient.get<{ request: DetailRequest }>(`/hr/onboarding/${row.id}`);
            if (!res.success || !res.data) throw new Error(res.error || 'Failed to load draft');
            setFormValues(detailRequestToFormValues(res.data.request));
            setFieldErrors({});
            setDraftId(row.id);
            setFillingDraft(true);
            setActiveSection('personal');
            setRejoinerHint(null);
            setView('create');
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to open draft.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setOpeningDraftId(null);
        }
    };

    const sectionIndex = SECTIONS.findIndex((s) => s.id === activeSection);
    const isFirstSection = sectionIndex <= 0;
    const isLastSection = sectionIndex === SECTIONS.length - 1;
    const goPreviousSection = () => { if (!isFirstSection) setActiveSection(SECTIONS[sectionIndex - 1].id); };
    const goNextSection = () => { if (!isLastSection) setActiveSection(SECTIONS[sectionIndex + 1].id); };

    const handleDeleteConfirm = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            const res = await apiClient.delete(`/hr/onboarding/${deleteTarget.id}`);
            if (res.success) {
                toast({ title: 'Deleted', description: 'Onboarding request deleted.' });
                setDeleteTarget(null);
                await fetchRows();
            } else {
                throw new Error(res.error || 'Failed to delete request');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to delete request.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setDeleting(false);
        }
    };

    const closeDetailView = () => {
        setView('list');
        setDetailId(null);
        setDetailRow(null);
        setDetailWorkflow(null);
        setCredentials(null);
        setEditingBranch(false);
        setRejoinerHint(null);
        sessionStorage.removeItem(PENDING_CREDENTIALS_KEY);
    };

    const openDetail = async (row: OnboardingRow): Promise<DetailRequest | null> => {
        setView('detail');
        setDetailId(row.id);
        setDetailRow(row);
        setDetailWorkflow(null);
        setCredentials(null);
        setRejoinerHint(null);
        setActionRemarks('');
        setEditingBranch(false);
        setNewBranchId('');
        setFinalizeDesignationId('');
        setFinalizeDepartmentId('');
        setFinalizeManagerId('');
        setFinalizeDateOfJoining(new Date().toISOString().split('T')[0]);
        setFinalizeEmployeeId('');
        setFinalizePassword('');
        setSubmitBranchId('');
        setAdditionalBranchIds([]);
        try {
            const res = await apiClient.get<{
                request: DetailRequest;
                workflow: WorkflowStatus | null;
            }>(`/hr/onboarding/${row.id}`);
            if (res.success && res.data) {
                setDetailRow(res.data.request);
                if (res.data.workflow) setDetailWorkflow(res.data.workflow);
                const req = res.data.request;
                if (req.branchId) setSubmitBranchId(req.branchId);
                if (req.designationId) setFinalizeDesignationId(req.designationId);
                if (req.departmentId) setFinalizeDepartmentId(req.departmentId);
                if (req.reportingManagerId) setFinalizeManagerId(req.reportingManagerId);
                if (req.dateOfJoining) {
                    setFinalizeDateOfJoining(new Date(req.dateOfJoining).toISOString().split('T')[0]);
                }
                return req;
            }
        } catch {
            // non-fatal — dialog still shows the row without a timeline
        }
        return null;
    };

    // Sources the ID card photo from whichever documents catalog is
    // authoritative right now — the request's own OnboardingDocument rows
    // pre-approval, or the real employee's EmployeeDocument catalog once
    // provisioned (onboarding docs get copied there on final approval — see
    // app/api/hr/onboarding/[id]/action/route.ts). Both use the same
    // KYC / "Photo" slot as the Documents tab's Photo tile.
    const resolveIdCardPhotoUrl = async (requestId: string, employeeUserId?: string | null): Promise<string | null> => {
        try {
            const docsRes = employeeUserId
                ? await apiClient.get<{ category: string; subtype: string | null; fileUrl: string }[]>(`/hr/employee-documents?employeeId=${employeeUserId}`)
                : await apiClient.get<{ category: string; subtype: string | null; fileUrl: string }[]>(`/hr/onboarding/${requestId}/documents`);
            const photoDoc = docsRes.success && docsRes.data ? docsRes.data.find((d) => d.category === 'KYC' && d.subtype === 'Photo') : null;
            if (!photoDoc) return null;
            // Same-origin proxy, not a signed GCS URL — the ID card photo has to
            // be readable back out of a <canvas> for the PDF export
            // (html2canvas), which a cross-origin <img> (the GCS bucket sets no
            // CORS headers for this app's origin) silently blocks even though it
            // displays fine on screen. See app/api/storage/proxy/route.ts.
            return `/api/storage/proxy?key=${encodeURIComponent(photoDoc.fileUrl)}`;
        } catch {
            return null;
        }
    };

    // Once the employee account exists, the card is built from the live User
    // row (GET /api/hr/employees/[id]/id-card) — the record Employee Master
    // edits after approval locks this onboarding request — and the server only
    // returns it when the employee is eligible (otherwise the hook shows what's
    // missing). Keyed by request id so the row's button shows the spinner.
    const openLiveIdCard = (userId: string, requestId: string) => {
        cardRequestIdRef.current = requestId;
        void openForEmployee(userId, requestId);
    };

    // Not provisioned yet: an unofficial preview built from the onboarding
    // request + the live finalize choices (Employee ID shows PENDING until then).
    // `overrideRow` lets a caller pass an explicit request row straight
    // through instead of reading the `detailRow` state.
    const handleOpenIdCard = (empId?: string, overrideRow?: DetailRequest) => {
        const row = overrideRow ?? detailRow;
        const requestId = overrideRow ? overrideRow.id : detailId;
        if (!row || !requestId) return;
        const provisionedUserId = row.createdUser?.id ?? credentials?.userId;
        if (provisionedUserId) {
            openLiveIdCard(provisionedUserId, requestId);
            return;
        }
        const usingLiveFinalizeState = !overrideRow;
        const assignedDesig = (usingLiveFinalizeState && lookups.designations.find((d) => d.id === finalizeDesignationId)?.label) || row.designation?.name || null;
        const assignedDept = (usingLiveFinalizeState && lookups.departments.find((d) => d.id === finalizeDepartmentId)?.label) || row.department?.name || null;
        const finalEmpId = empId || (usingLiveFinalizeState && credentials?.employeeId) || row.createdUser?.employeeId || row.generatedEmployeeId || (usingLiveFinalizeState && finalizeEmployeeId) || 'PENDING';

        cardRequestIdRef.current = requestId;
        setIdCardData({
            fullName: row.employeeName || 'New Joinee',
            employeeId: finalEmpId,
            designation: assignedDesig,
            department: assignedDept,
            branchName: (usingLiveFinalizeState && lookups.branches.find((b) => b.id === submitBranchId)?.label) || row.branch?.name || null,
            branchCode: null,
            dateOfJoining: (usingLiveFinalizeState && finalizeDateOfJoining) || row.dateOfJoining || null,
            dateOfBirth: row.dateOfBirth,
            bloodGroup: row.bloodGroup,
            emergencyContactName: row.emergencyContactName,
            emergencyContactRelation: row.emergencyContactRelation ?? null,
            emergencyContactMobile: row.emergencyContactNumber,
            mobileNumber: row.mobileNumber,
            photoUrl: null,
            address: row.currentAddress,
        });
        setIdCardOpen(true);

        // Photo loads in the background so opening the card isn't blocked on it.
        resolveIdCardPhotoUrl(requestId, row.createdUser?.id).then((photoUrl) => {
            if (cardRequestIdRef.current === requestId && photoUrl) {
                setIdCardData((prev) => (prev ? { ...prev, photoUrl } : prev));
            }
        });
    };

    const handleOpenIdCardFromQueue = (row: OnboardingRow) => {
        if (row.createdUser?.id) {
            openLiveIdCard(row.createdUser.id, row.id);
            return;
        }

        // Not provisioned yet — preview from the onboarding request.
        cardRequestIdRef.current = row.id;
        setIdCardData({
            fullName: row.employeeName || 'New Joinee',
            employeeId: 'PENDING',
            designation: row.designation?.name || null,
            department: row.department?.name || null,
            branchName: row.branch?.name || null,
            branchCode: null,
            photoUrl: null,
            dateOfJoining: null,
            dateOfBirth: null,
            bloodGroup: null,
            emergencyContactName: null,
            emergencyContactMobile: null,
            mobileNumber: null,
            address: null,
        });
        setIdCardOpen(true);

        // Photo loads in parallel without blocking initial modal paint
        resolveIdCardPhotoUrl(row.id, row.createdUser?.id ?? null).then((photoUrl) => {
            if (cardRequestIdRef.current === row.id && photoUrl) {
                setIdCardData((prev) => (prev ? { ...prev, photoUrl } : prev));
            }
        });

        // Background enrich full record
        apiClient
            .get<{
                request: DetailRequest;
                workflow: WorkflowStatus | null;
                suggestedEmployeeId?: string;
            }>(`/hr/onboarding/${row.id}`)
            .then((res) => {
                if (cardRequestIdRef.current !== row.id) return;
                if (res.success && res.data?.request) {
                    const req = res.data.request;
                    setIdCardData((prev) =>
                        prev
                            ? {
                                  ...prev,
                                  dateOfJoining: req.dateOfJoining || prev.dateOfJoining,
                                  bloodGroup: req.bloodGroup ?? prev.bloodGroup,
                                  emergencyContactName: req.emergencyContactName ?? prev.emergencyContactName,
                                  emergencyContactRelation: req.emergencyContactRelation ?? prev.emergencyContactRelation,
                                  emergencyContactMobile: req.emergencyContactNumber ?? prev.emergencyContactMobile,
                                  mobileNumber: req.mobileNumber ?? prev.mobileNumber,
                                  dateOfBirth: req.dateOfBirth ?? prev.dateOfBirth,
                                  address: req.currentAddress ?? prev.address,
                                  designation: req.designation?.name || prev.designation,
                                  department: req.department?.name || prev.department,
                                  branchName: req.branch?.name || prev.branchName,
                                  employeeId: req.createdUser?.employeeId || req.generatedEmployeeId || prev.employeeId,
                              }
                            : prev
                    );
                } else {
                    toast({
                        title: "Showing basic details — couldn't load full record",
                    });
                }
            })
            .catch(() => {
                if (cardRequestIdRef.current !== row.id) return;
                toast({
                    title: "Showing basic details — couldn't load full record",
                });
            });
    };

    const handleChangeBranch = async () => {
        if (!detailId || !newBranchId || !detailRow) return;
        setChangingBranch(true);
        try {
            const res = await apiClient.patch(`/hr/onboarding/${detailId}/branch`, { branchId: newBranchId });
            if (!res.success) throw new Error(res.error || 'Failed to update branch');
            toast({ title: 'Branch updated' });
            setEditingBranch(false);
            await openDetail(detailRow);
            await fetchRows();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to update branch.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setChangingBranch(false);
        }
    };

    const canSubmitForApproval = detailRow && !detailWorkflow && ['DRAFT', 'SUBMITTED', 'IN_REVIEW'].includes(detailRow.status);
    // Non-Head-Office staff can only assign a branch they themselves have
    // access to — mirrors isBranchScopePermitted, enforced again server-side.
    const submitBranchOptions = isHeadOffice
        ? lookups.branches
        : lookups.branches.filter((b) => branchAccess.some((ba) => ba.branchId === b.id));
    const addBranchOptions = submitBranchOptions.filter(
        (b) => b.id !== submitBranchId && !additionalBranchIds.includes(b.id)
    );
    const canAct = detailRow && (detailRow.status === 'PENDING_APPROVAL' || detailRow.status === 'IN_PROGRESS');
    // Branch can only be corrected while Stage 1 is still undecided — once any
    // stage has acted, a real approver already exercised authority based on
    // that branch assignment. Checking detailRow.status alone isn't enough
    // (it stays PENDING_APPROVAL through every intermediate stage too).
    const firstDetailStage = detailWorkflow?.stages.find((s) => s.stageOrder === 1);
    const canChangeBranch = !!(
        detailRow?.status === 'PENDING_APPROVAL' &&
        detailWorkflow?.instance.status === 'PENDING' &&
        firstDetailStage?.status === 'PENDING'
    );
    const maxStageOrder = detailWorkflow ? Math.max(...detailWorkflow.stages.map((s) => s.stageOrder)) : null;
    const currentDetailStage = detailWorkflow?.stages.find((s) => s.stageId === detailWorkflow.instance.currentStageId);
    const isFinalStage = detailWorkflow != null && currentDetailStage?.stageOrder === maxStageOrder;
    // Unified Option A: Single-screen direct finalization & approval.
    // Available when sitting at final stage or ready for initial direct admin approval.
    const canDirectlyFinalize = Boolean(
        (canAct && isFinalStage) || canSubmitForApproval
    );

    const missingFinalizeFields: string[] = [];
    if (canDirectlyFinalize) {
        if (!submitBranchId) missingFinalizeFields.push('Branch');
        if (isOrgFieldRequired('designationId') && !finalizeDesignationId) missingFinalizeFields.push('Designation');
        if (isOrgFieldRequired('departmentId') && !finalizeDepartmentId) missingFinalizeFields.push('Department');
        if (showReportingManagerField && isOrgFieldRequired('reportingManagerId') && !finalizeManagerId) missingFinalizeFields.push('Reporting Manager');
        if (isOrgFieldRequired('dateOfJoining') && !finalizeDateOfJoining) missingFinalizeFields.push('Date of Joining');
        if (!finalizeEmployeeId) missingFinalizeFields.push('Employee ID');
        if (!finalizePassword || finalizePassword.length < 8) missingFinalizeFields.push('Password (min 8 characters)');
        if (!finalizeMonthlyCtc || Number(finalizeMonthlyCtc) < 0) missingFinalizeFields.push('Month CTC Pay');
        if (isOrgFieldRequired('monthlyCtc') && (!finalizeMonthlyCtc || Number(finalizeMonthlyCtc) < 0)) missingFinalizeFields.push('Month CTC Pay');
    }
    const finalizeApproveDisabled = canDirectlyFinalize && missingFinalizeFields.length > 0;

    const handleAction = async (action: 'approve' | 'reject' | 'send_back') => {
        if (!detailId) return;
        setActing(true);
        try {
            // Option A: If request hasn't been submitted to the approval workflow yet, auto-submit with branch & department first
            if (canSubmitForApproval) {
                if (action === 'approve') {
                    if (!submitBranchId) {
                        throw new Error('Please select a Branch before approving.');
                    }
                    const submitRes = await apiClient.post<{ rejoinerHint?: RejoinerHint | null }>(
                        `/hr/onboarding/${detailId}/submit-for-approval`,
                        {
                            branchId: submitBranchId,
                            departmentId: finalizeDepartmentId || undefined,
                            designationId: finalizeDesignationId || undefined,
                        }
                    );
                    if (!submitRes.success) {
                        throw new Error(submitRes.error || 'Failed to submit for approval');
                    }
                    if (submitRes.data?.rejoinerHint) {
                        applyRejoinerHint(submitRes.data.rejoinerHint);
                    }
                } else if (action === 'reject') {
                    const fallbackBranchId = submitBranchId || lookups.branches[0]?.id;
                    if (fallbackBranchId) {
                        await apiClient.post(`/hr/onboarding/${detailId}/submit-for-approval`, {
                            branchId: fallbackBranchId,
                            departmentId: finalizeDepartmentId || undefined,
                            designationId: finalizeDesignationId || undefined,
                        });
                    }
                }
            }

            const body: Record<string, unknown> = { action, remarks: actionRemarks || undefined };
            if (action === 'approve' && canDirectlyFinalize) {
                Object.assign(body, {
                    designationId: finalizeDesignationId || undefined,
                    departmentId: finalizeDepartmentId || undefined,
                    reportingManagerId: finalizeManagerId || undefined,
                    dateOfJoining: finalizeDateOfJoining || undefined,
                    employeeId: finalizeEmployeeId,
                    password: finalizePassword,
                    monthlyCtc: finalizeMonthlyCtc ? Number(finalizeMonthlyCtc) : undefined,
                    additionalBranchIds: additionalBranchIds.length > 0 ? additionalBranchIds : undefined,
                });
            }
            const res = await apiClient.post<{
                employeeId?: string;
                temporaryPassword?: string;
                rejoinerHint?: RejoinerHint | null;
                request?: { createdUserId?: string | null };
            }>(`/hr/onboarding/${detailId}/action`, body);
            if (res.success) {
                if (res.data?.employeeId && res.data?.temporaryPassword) {
                    setCredentials({
                        employeeId: res.data.employeeId,
                        temporaryPassword: res.data.temporaryPassword,
                        userId: res.data.request?.createdUserId ?? undefined,
                    });
                    const pending: PendingCredentials = { requestId: detailId, employeeId: res.data.employeeId, temporaryPassword: res.data.temporaryPassword };
                    sessionStorage.setItem(PENDING_CREDENTIALS_KEY, JSON.stringify(pending));
                    applyRejoinerHint(res.data.rejoinerHint);
                } else {
                    closeDetailView();
                }
                toast({ title: 'Done', description: `Request ${action.replace('_', ' ')} recorded.` });
                await fetchRows();
            } else {
                throw new Error(res.error || 'Action failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Action failed.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setActing(false);
        }
    };

    const copyCredentials = () => {
        if (!credentials) return;
        navigator.clipboard.writeText(`Employee ID: ${credentials.employeeId}\nPassword: ${credentials.temporaryPassword}`);
        toast({ title: 'Copied to clipboard' });
    };

    if (isLoading) return <PageLoader label="Loading onboarding requests..." fullScreen={false} />;

    // Informational-only "possible rejoiner" banner — mirrors the existing
    // amber alert pattern used elsewhere on this page. Dismissible,
    // non-blocking, never affects Approve gating.
    const rejoinerBanner = rejoinerHint && !rejoinerDismissed ? (
        <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5 mb-4">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500 mt-0.5" />
            <div className="flex-1">
                <span>
                    Possible rejoiner: <strong>{rejoinerHint.name}</strong>
                    {rejoinerHint.employeeId ? ` (${rejoinerHint.employeeId})` : ''}, exited{' '}
                    {rejoinerHint.dateOfExit ? toDisplayDate(new Date(rejoinerHint.dateOfExit)) : 'unknown date'}.
                </span>
                <div className="flex items-center gap-3 mt-1.5">
                    {rejoinerRowId ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/40"
                            onClick={() => router.push(`/dashboard/hr/employees/${rejoinerRowId}`)}
                        >
                            View old record
                        </Button>
                    ) : rejoinerRowId === null ? (
                        <span className="text-amber-600/80 italic">Old record could not be located.</span>
                    ) : (
                        <span className="text-amber-600/80 italic">Looking up old record…</span>
                    )}
                </div>
            </div>
            <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6 flex-shrink-0 text-amber-600 hover:bg-amber-100 dark:hover:bg-amber-950/40"
                onClick={() => setRejoinerDismissed(true)}
                title="Dismiss"
            >
                <X className="h-3.5 w-3.5" />
            </Button>
        </div>
    ) : null;

    const filteredRows = rows.filter((row) => {
        if (filterStatus !== 'ALL' && row.status !== filterStatus) return false;
        if (filterBranchId !== 'ALL' && (row.branch?.name ?? '') !== filterBranchId) return false;
        if (filterDepartmentId !== 'ALL' && (row.department?.name ?? '') !== filterDepartmentId) return false;
        if (filterSearch.trim()) {
            const query = filterSearch.toLowerCase();
            const nameMatch = row.employeeName?.toLowerCase().includes(query);
            const empIdMatch = row.createdUser?.employeeId?.toLowerCase().includes(query);
            if (!nameMatch && !empIdMatch) return false;
        }
        return true;
    });

    const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
    const safePage = Math.min(currentPage, totalPages);
    const paginatedRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);

    const handleFilterSearchChange = (val: string) => {
        setFilterSearch(val);
        setCurrentPage(1);
    };
    const handleFilterStatusChange = (val: string) => {
        setFilterStatus(val);
        setCurrentPage(1);
    };
    const handleFilterBranchChange = (val: string) => {
        setFilterBranchId(val);
        setCurrentPage(1);
    };
    const handleFilterDepartmentChange = (val: string) => {
        setFilterDepartmentId(val);
        setCurrentPage(1);
    };
    const handlePageSizeChange = (val: string) => {
        setPageSize(Number(val));
        setCurrentPage(1);
    };

    // Shared by the "Manual Entry" tab (new request) and draft filling
    // (openDraft) — one step-by-step form regardless of how the request
    // started: Generate Link (joinee fills it), Manual Entry, or an admin
    // finishing an existing draft.
    const manualEntryForm = (
        <>
            <OnboardingOrgPicker
                value={{ regionId: formValues.regionId, divisionId: formValues.divisionId, shiftId: formValues.shiftId }}
                onChange={(field, next) => handleFormChange(field, next)}
            />
            <OnboardingRequestForm
                values={formValues}
                onChange={handleFormChange}
                onChildrenChange={handleChildrenChange}
                activeSection={activeSection}
                onSectionChange={setActiveSection}
                errors={fieldErrors}
                onBlurField={handleFieldBlur}
                documentsSlot={
                    draftId ? (
                        <OnboardingDocumentUploader requestId={draftId} />
                    ) : (
                        <p className="text-sm text-slate-500 py-4 flex items-center gap-2">
                            {draftCreating && <Loader2 className="h-4 w-4 animate-spin" />}
                            {draftCreating ? 'Saving draft…' : 'Save Draft once to attach documents here.'}
                        </p>
                    )
                }
            />
            <div className="flex items-center justify-between pt-4 border-t flex-wrap gap-3">
                <Button variant="outline" onClick={goPreviousSection} disabled={isFirstSection} className="gap-2">
                    <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <div className="flex items-center gap-2 flex-wrap">
                    <Button variant="outline" onClick={closeCreateView}>Cancel</Button>
                    <Button variant="outline" onClick={handleSaveDraft} disabled={savingDraft} className="gap-2">
                        <Save className="h-4 w-4" /> {savingDraft ? 'Saving...' : 'Save Draft'}
                    </Button>
                    {isLastSection && (
                        <Button
                            onClick={handleCreate}
                            disabled={creating}
                            className="bg-primary text-white gap-2"
                        >
                            {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                            Create Request
                        </Button>
                    )}
                    {!isLastSection && (
                        <Button onClick={goNextSection} variant="outline" className="gap-2">
                            Next <ChevronRight className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            </div>
        </>
    );

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-6xl space-y-6">
                {view === 'list' ? (
                    <>
                        <div className="mb-8 flex items-center justify-between mt-4 gap-4 flex-wrap sm:flex-nowrap">
                            <div className="flex items-center gap-4 min-w-0 flex-1">
                                <div className="relative flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                                    <UserPlus className="h-7 w-7 text-white" />
                                </div>
                                <div className="min-w-0">
                                    <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">New Employee Requests</h1>
                                    <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                        Enter details manually, or generate a shareable link for the joinee to fill in themselves.
                                        Employee ID &amp; password are only created once a request clears approval.
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center justify-end flex-shrink-0 ml-auto">
                                <Button onClick={() => setView('create')} className="bg-primary text-white whitespace-nowrap shadow-sm">
                                    <Plus className="h-4 w-4 mr-2" />
                                    New Employee
                                </Button>
                            </div>
                        </div>

                        {/* ── Search & Filters ── */}
                        <div className="flex flex-wrap items-center gap-3 bg-white/70 dark:bg-brand-green-darker/30 p-3.5 rounded-xl border border-primary/20">
                            <div className="relative flex-1 min-w-[200px]">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                <Input
                                    placeholder="Search by candidate name or EMP code..."
                                    value={filterSearch}
                                    onChange={(e) => handleFilterSearchChange(e.target.value)}
                                    className="pl-9 bg-white dark:bg-slate-900 text-xs"
                                />
                            </div>
                            <div className="w-[150px]">
                                <Select value={filterStatus} onValueChange={handleFilterStatusChange}>
                                    <SelectTrigger className="bg-white dark:bg-slate-900 text-xs h-9">
                                        <SelectValue placeholder="All Statuses" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">All Statuses</SelectItem>
                                        <SelectItem value="DRAFT">Draft</SelectItem>
                                        <SelectItem value="SUBMITTED">Submitted</SelectItem>
                                        <SelectItem value="PENDING_APPROVAL">Pending Approval</SelectItem>
                                        <SelectItem value="APPROVED">Approved</SelectItem>
                                        <SelectItem value="REJECTED">Rejected</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="w-[160px]">
                                <Select value={filterBranchId} onValueChange={handleFilterBranchChange}>
                                    <SelectTrigger className="bg-white dark:bg-slate-900 text-xs h-9">
                                        <SelectValue placeholder="All Branches" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">All Branches</SelectItem>
                                        {lookups.branches.map((b) => (
                                            <SelectItem key={b.id} value={b.label}>{b.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="w-[160px]">
                                <Select value={filterDepartmentId} onValueChange={handleFilterDepartmentChange}>
                                    <SelectTrigger className="bg-white dark:bg-slate-900 text-xs h-9">
                                        <SelectValue placeholder="All Departments" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">All Departments</SelectItem>
                                        {lookups.departments.map((d) => (
                                            <SelectItem key={d.id} value={d.label}>{d.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            {(filterSearch || filterStatus !== 'ALL' || filterBranchId !== 'ALL' || filterDepartmentId !== 'ALL') && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setFilterSearch('');
                                        setFilterStatus('ALL');
                                        setFilterBranchId('ALL');
                                        setFilterDepartmentId('ALL');
                                        setCurrentPage(1);
                                    }}
                                    className="text-xs h-9"
                                >
                                    Reset
                                </Button>
                            )}
                        </div>

                        <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                                <TableHead>Name</TableHead>
                                                <TableHead>Branch</TableHead>
                                                <TableHead>Department</TableHead>
                                                <TableHead>Source</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead>Created</TableHead>
                                                <TableHead className="text-center">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {paginatedRows.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={7} className="px-4 py-12 text-center text-slate-500">
                                                        {rows.length === 0 ? 'No onboarding requests yet.' : 'No requests match the selected filters.'}
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                paginatedRows.map((row) => (
                                                    <TableRow key={row.id}>
                                                        <TableCell className="text-sm font-medium">
                                                            {row.employeeName ?? <span className="text-slate-400 italic">Not filled in yet</span>}
                                                            {row.createdUser?.employeeId && (
                                                                <div className="text-xs text-slate-500">{row.createdUser.employeeId}</div>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-sm">{row.branch?.name ?? '—'}</TableCell>
                                                        <TableCell className="text-sm">{row.department?.name ?? '—'}</TableCell>
                                                        <TableCell className="text-sm">{row.source === 'LINK' ? 'Link' : 'Manual'}</TableCell>
                                                        <TableCell><Badge variant={statusVariant(row.status)}>{row.status.replace('_', ' ')}</Badge></TableCell>
                                                        <TableCell className="text-sm">{toDisplayDate(new Date(row.createdAt))}</TableCell>
                                                        <TableCell className="text-center">
                                                            <div className="flex items-center justify-center gap-1">
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => (row.status === 'DRAFT' ? openDraft(row) : openDetail(row))}
                                                                    disabled={openingDraftId === row.id}
                                                                    title={row.status === 'DRAFT' ? 'Fill details' : 'View'}
                                                                >
                                                                    {openingDraftId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                                                                </Button>
                                                                {(row.status === 'APPROVED' || row.createdUser?.employeeId) && (
                                                                    <Button
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        onClick={() => handleOpenIdCardFromQueue(row)}
                                                                        disabled={loadingIdCardFor === row.id}
                                                                        title="View ID Card"
                                                                        className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                                                                    >
                                                                        {loadingIdCardFor === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <IdCard className="h-4 w-4" />}
                                                                    </Button>
                                                                )}
                                                                {canDelete(row) && (
                                                                    <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(row)} title="Delete" className="text-red-600">
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </Button>
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                                {filteredRows.length > 0 && (
                                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-sidebar-accent px-4 py-3 bg-white/50 dark:bg-brand-green-darker/20">
                                        <div className="flex items-center gap-3">
                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filteredRows.length)} of {filteredRows.length}
                                            </p>
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-xs text-slate-500 dark:text-slate-400">Rows:</span>
                                                <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                                                    <SelectTrigger className="h-7 w-[70px] bg-white dark:bg-slate-900 text-xs">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="10">10</SelectItem>
                                                        <SelectItem value="25">25</SelectItem>
                                                        <SelectItem value="50">50</SelectItem>
                                                        <SelectItem value="100">100</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                                disabled={safePage <= 1}
                                                className="h-8 gap-1 text-xs"
                                            >
                                                <ChevronLeft className="h-3.5 w-3.5" />
                                                Previous
                                            </Button>
                                            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 px-1">
                                                Page {safePage} of {totalPages}
                                            </span>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                                disabled={safePage >= totalPages}
                                                className="h-8 gap-1 text-xs"
                                            >
                                                Next
                                                <ChevronRight className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </>
                ) : view === 'create' ? (
                    <>
                        {/* ── Create: generate link, or manual entry — full page, not a modal ── */}
                        <div className="mb-8 flex items-center gap-4 mt-4">
                            <Button variant="ghost" size="icon" onClick={closeCreateView} title="Back">
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                                <UserPlus className="h-7 w-7 text-white" />
                            </div>
                            <div>
                                <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    {fillingDraft ? (formValues.employeeName || 'Draft Request') : 'New Employee'}
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    {fillingDraft
                                        ? 'Fill in the joinee’s details step by step. Save the draft anytime and come back to it.'
                                        : 'Generate a shareable link, or enter the joinee’s details yourself.'}
                                </p>
                            </div>
                        </div>

                        <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                            <CardContent className="p-6">
                                {rejoinerBanner}
                                {fillingDraft ? (
                                    <div className="space-y-4">{manualEntryForm}</div>
                                ) : (
                                <Tabs defaultValue="link">
                                    <TabsList className="grid w-full grid-cols-2">
                                        <TabsTrigger value="link" className="gap-1.5"><Link2 className="h-3.5 w-3.5" /> Generate Link</TabsTrigger>
                                        <TabsTrigger value="manual" className="gap-1.5"><UserPlus className="h-3.5 w-3.5" /> Manual Entry</TabsTrigger>
                                    </TabsList>

                                    <TabsContent value="link" className="space-y-4 py-2">
                                        <p className="text-sm text-gray-500">
                                            Generate a one-time link and share it with the new joinee via WhatsApp or email —
                                            they fill in their own details, no login needed.
                                        </p>
                                        {generatedLink ? (
                                            <div className="space-y-3 max-w-lg">
                                                <div className="flex items-center gap-2 bg-green-50 border border-primary/30 rounded-lg px-3 py-2">
                                                    <Input readOnly value={generatedLink} className="bg-white text-xs" />
                                                    <Button size="icon" variant="outline" onClick={copyLink} title="Copy">
                                                        <Copy className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                                {generatedLinkExpiry && (
                                                    <p className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
                                                        <Clock className="h-3.5 w-3.5 text-slate-500" />
                                                        Valid until {formatExpiryDate(generatedLinkExpiry)}
                                                    </p>
                                                )}
                                                <div className="flex gap-2">
                                                    <a
                                                        className="flex-1"
                                                        href={`https://wa.me/?text=${encodeURIComponent(`Please fill in your onboarding details here: ${generatedLink}`)}`}
                                                        target="_blank" rel="noopener noreferrer"
                                                    >
                                                        <Button variant="outline" className="w-full gap-2"><MessageCircle className="h-4 w-4" /> WhatsApp</Button>
                                                    </a>
                                                    <a
                                                        className="flex-1"
                                                        href={`mailto:?subject=${encodeURIComponent('Complete your onboarding details')}&body=${encodeURIComponent(`Please fill in your onboarding details here: ${generatedLink}`)}`}
                                                    >
                                                        <Button variant="outline" className="w-full gap-2"><Mail className="h-4 w-4" /> Email</Button>
                                                    </a>
                                                </div>

                                                <Button variant="outline" onClick={closeCreateView} className="gap-2">
                                                    <ArrowLeft className="h-4 w-4" /> Back to requests
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="space-y-3 max-w-lg">
                                                <OnboardingOrgPicker value={linkOrg} onChange={(field, next) => setLinkOrg((prev) => ({ ...prev, [field]: next }))} />
                                                <div className="flex flex-wrap items-end gap-3">
                                                    <div className="space-y-1">
                                                        <Label htmlFor="link-days-select" className="text-xs text-slate-500 font-medium">
                                                            Days (0–30)
                                                        </Label>
                                                        <Select
                                                            value={String(linkExpiryDays)}
                                                            onValueChange={(val) => setLinkExpiryDays(Number(val))}
                                                        >
                                                            <SelectTrigger id="link-days-select" className="w-[130px] bg-white">
                                                                <SelectValue placeholder="Days" />
                                                            </SelectTrigger>
                                                            <SelectContent className="max-h-56">
                                                                {Array.from({ length: 31 }, (_, i) => (
                                                                    <SelectItem key={i} value={String(i)}>
                                                                        {i} {i === 1 ? 'day' : 'days'}{i === 7 ? ' (default)' : ''}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>

                                                    <div className="space-y-1">
                                                        <Label htmlFor="link-hours-select" className="text-xs text-slate-500 font-medium">
                                                            Hours (0–23)
                                                        </Label>
                                                        <Select
                                                            value={String(linkExpiryHours)}
                                                            onValueChange={(val) => setLinkExpiryHours(Number(val))}
                                                        >
                                                            <SelectTrigger id="link-hours-select" className="w-[120px] bg-white">
                                                                <SelectValue placeholder="Hours" />
                                                            </SelectTrigger>
                                                            <SelectContent className="max-h-56">
                                                                {Array.from({ length: 24 }, (_, i) => (
                                                                    <SelectItem key={i} value={String(i)}>
                                                                        {i} {i === 1 ? 'hour' : 'hours'}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>

                                                    <Button
                                                        onClick={handleGenerateLink}
                                                        disabled={generatingLink || linkExpiryDays * 24 + linkExpiryHours < 1 || linkExpiryDays * 24 + linkExpiryHours > 720}
                                                        className="gap-2"
                                                    >
                                                        <Send className="h-4 w-4" /> Generate Link
                                                    </Button>
                                                </div>
                                                <p className={`text-xs ${linkExpiryDays * 24 + linkExpiryHours < 1 || linkExpiryDays * 24 + linkExpiryHours > 720 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-slate-500'}`}>
                                                    {formatLiveExpiryHint(linkExpiryDays, linkExpiryHours)}
                                                </p>
                                            </div>
                                        )}
                                    </TabsContent>

                                    <TabsContent value="manual" className="py-2 space-y-4">
                                        {manualEntryForm}
                                    </TabsContent>
                                </Tabs>
                                )}
                            </CardContent>
                        </Card>
                    </>
                ) : (
                    <>
                        {/* ── Detail / review / approve — full page, not a modal (the
                             Documents tab's tile grid needs real page width) ── */}
                        <div className="mb-8 flex items-center gap-4 mt-4">
                            <Button variant="ghost" size="icon" onClick={closeDetailView} title="Back">
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                                <UserPlus className="h-7 w-7 text-white" />
                            </div>
                            <div className="flex items-center justify-between gap-4 flex-wrap flex-1">
                                <div>
                                    <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white flex items-center gap-3 flex-wrap">
                                        {detailRow?.employeeName ?? 'Onboarding Request'}
                                        {detailRow && <Badge variant={statusVariant(detailRow.status)}>{detailRow.status.replace('_', ' ')}</Badge>}
                                    </h1>
                                </div>
                                {detailRow && (detailRow.status === 'APPROVED' || detailRow.createdUser?.employeeId) && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => handleOpenIdCard(detailRow.createdUser?.employeeId ?? undefined)}
                                        disabled={loadingIdCardFor === detailRow.id}
                                        className="gap-2 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                                    >
                                        {loadingIdCardFor === detailRow.id ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <IdCard className="h-4 w-4 text-amber-500" />
                                        )}{' '}
                                        View ID Card
                                    </Button>
                                )}
                            </div>
                        </div>

                        <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                            <CardContent className="p-6">
                    {rejoinerBanner}
                    {credentials ? (
                        <div className="space-y-4 max-w-lg">
                            <div className="flex items-start gap-3 bg-green-50 border border-primary/30 rounded-lg px-4 py-3">
                                <KeyRound className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                                <div className="text-sm">
                                    <p className="font-medium text-sidebar-accent">Account created — shown once</p>
                                    <p className="mt-1">Employee ID: <span className="font-mono font-semibold">{credentials.employeeId}</span></p>
                                    <p>Password: <span className="font-mono font-semibold">{credentials.temporaryPassword}</span></p>
                                </div>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                                <Button variant="outline" onClick={copyCredentials} className="flex-1 gap-2">
                                    <Copy className="h-3.5 w-3.5" /> Copy Credentials
                                </Button>
                                <Button
                                    type="button"
                                    onClick={() => handleOpenIdCard(credentials.employeeId)}
                                    className="flex-1 gap-2 bg-amber-600 hover:bg-amber-700 text-white shadow"
                                >
                                    <IdCard className="h-4 w-4" /> Preview ID Card
                                </Button>
                            </div>
                        </div>
                    ) : (
                        detailRow && (
                            <div className="space-y-4">
                                {canDirectlyFinalize && (
                                    <div className="max-w-3xl">
                                        <Card>
                                            <CardHeader className="pb-2"><CardTitle className="text-sm">Finalize Employee Details</CardTitle></CardHeader>
                                            <CardContent>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                <div>
                                                    <Label className="mb-1.5 block text-xs text-gray-500">
                                                        Branch / Location<span className="text-red-500">*</span>
                                                    </Label>
                                                    <Select value={submitBranchId} onValueChange={setSubmitBranchId}>
                                                        <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                                                        <SelectContent>
                                                            {submitBranchOptions.map((b) => (
                                                                <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    <div className="mt-2 space-y-2">
                                                        {additionalBranchIds.length > 0 && (
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {additionalBranchIds.map((id) => {
                                                                    const label = lookups.branches.find((b) => b.id === id)?.label || id;
                                                                    return (
                                                                        <Badge key={id} variant="outline" className="gap-1 pr-1">
                                                                            {label}
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => setAdditionalBranchIds((prev) => prev.filter((b) => b !== id))}
                                                                                className="rounded-full hover:bg-slate-200 dark:hover:bg-slate-700"
                                                                            >
                                                                                <X className="h-3 w-3" />
                                                                            </button>
                                                                        </Badge>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                        {addBranchOptions.length > 0 && (
                                                            // Kept permanently mounted with a forced-empty value (never
                                                            // matches a real SelectItem) so it always shows the "Add
                                                            // Branch" placeholder — swapping this for a Button that
                                                            // unmounts the Select the instant it fires onValueChange
                                                            // raced Radix's own close sequence and silently dropped
                                                            // the pick.
                                                            <Select
                                                                value=""
                                                                onValueChange={(val) => setAdditionalBranchIds((prev) => [...prev, val])}
                                                            >
                                                                <SelectTrigger className="h-7 w-auto gap-1 text-xs">
                                                                    <Plus className="h-3 w-3" />
                                                                    <SelectValue placeholder="Add Branch" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {addBranchOptions.map((b) => (
                                                                        <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        )}
                                                    </div>
                                                </div>
                                                <div>
                                                    <Label className="mb-1.5 block text-xs text-gray-500">
                                                        Designation{isOrgFieldRequired('designationId') && <span className="text-red-500">*</span>}
                                                    </Label>
                                                    <Select value={finalizeDesignationId} onValueChange={setFinalizeDesignationId}>
                                                        <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
                                                        <SelectContent>
                                                            {lookups.designations.map((d) => <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div>
                                                    <Label className="mb-1.5 block text-xs text-gray-500">
                                                        Department{isOrgFieldRequired('departmentId') && <span className="text-red-500">*</span>}
                                                    </Label>
                                                    <Select value={finalizeDepartmentId} onValueChange={setFinalizeDepartmentId}>
                                                        <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                                                        <SelectContent>
                                                            {lookups.departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                {showReportingManagerField && (
                                                    <div>
                                                        <Label className="mb-1.5 block text-xs text-gray-500">
                                                            Reporting Manager{isOrgFieldRequired('reportingManagerId') && <span className="text-red-500">*</span>}
                                                        </Label>
                                                        <Select value={finalizeManagerId} onValueChange={setFinalizeManagerId}>
                                                            <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                                                            <SelectContent>
                                                                {lookups.managers.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                )}
                                                <div>
                                                    <Label className="mb-1.5 block text-xs text-gray-500">
                                                        Date of Joining{isOrgFieldRequired('dateOfJoining') && <span className="text-red-500">*</span>}
                                                    </Label>
                                                    <DateInput value={finalizeDateOfJoining} onChange={(e) => setFinalizeDateOfJoining(e.target.value)} />
                                                </div>
                                                <div>
                                                    <Label className="mb-1.5 block text-xs text-gray-500">
                                                        Employee ID<span className="text-red-500">*</span>
                                                    </Label>
                                                    <Input
                                                        placeholder="Enter employee ID"
                                                        value={finalizeEmployeeId}
                                                        onChange={(e) => setFinalizeEmployeeId(e.target.value)}
                                                        className="font-mono"
                                                    />
                                                </div>
                                                <div>
                                                    <Label className="mb-1.5 block text-xs text-gray-500">
                                                        Month CTC Pay<span className="text-red-500">*</span>
                                                        Month CTC Pay{isOrgFieldRequired('monthlyCtc') && <span className="text-red-500">*</span>}
                                                    </Label>
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        value={finalizeMonthlyCtc}
                                                        onChange={(e) => setFinalizeMonthlyCtc(e.target.value)}
                                                    />
                                                </div>
                                                <div className="sm:col-span-2">
                                                    <Label className="mb-1.5 block text-xs text-gray-500">
                                                        Password (min 8 characters)<span className="text-red-500">*</span>
                                                    </Label>
                                                    <PasswordInput
                                                        placeholder="Enter password (min 8 characters)"
                                                        value={finalizePassword}
                                                        onChange={(e) => setFinalizePassword(e.target.value)}
                                                        className="font-mono"
                                                    />
                                                </div>
                                                <div className="sm:col-span-2">
                                                    <Label className="mb-1.5 block text-xs text-gray-500">
                                                        Remarks (optional)
                                                    </Label>
                                                    <Input
                                                        placeholder="Add any remarks or notes..."
                                                        value={actionRemarks}
                                                        onChange={(e) => setActionRemarks(e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                            </CardContent>
                                        </Card>
                                    </div>
                                )}
                                {detailRow.status === 'APPROVED' || detailRow.createdUser?.employeeId ? (
                                    <Tabs defaultValue="documents">
                                        <TabsList className="grid w-full grid-cols-2">
                                            <TabsTrigger value="documents">Documents</TabsTrigger>
                                            <TabsTrigger value="details">Details</TabsTrigger>
                                        </TabsList>
                                        <TabsContent value="documents" className="py-4 space-y-4">
                                            {/* Read-only: the approver verifies what was submitted here; a
                                                request that needs correcting is rejected or sent back, not edited. */}
                                            <h3 className="text-sm font-medium text-gray-500">Submitted Details</h3>
                                            <DetailInfoSections request={detailRow} />
                                            <OnboardingDocumentUploader requestId={detailId!} readOnly={detailRow.status === 'APPROVED'} />
                                        </TabsContent>
                                        <TabsContent value="details">
                                            <div className="space-y-4 py-4 max-w-2xl">
                                                {detailRow.status === 'REJECTED' && detailRow.rejectionReason && (
                                                    <p className="text-sm text-red-600">Rejection reason: {detailRow.rejectionReason}</p>
                                                )}
                                                {detailRow.branch && !editingBranch && (
                                                    <div className="text-sm flex items-center gap-2">
                                                        Branch: <span className="font-medium">{detailRow.branch.name}</span>
                                                        {canChangeBranch && (
                                                            <Button size="sm" variant="link" className="h-auto p-0" onClick={() => { setNewBranchId(''); setEditingBranch(true); }}>
                                                                Change
                                                            </Button>
                                                        )}
                                                    </div>
                                                )}
                                                {editingBranch && (
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <Select value={newBranchId} onValueChange={setNewBranchId}>
                                                            <SelectTrigger className="w-56"><SelectValue placeholder="Select branch" /></SelectTrigger>
                                                            <SelectContent>
                                                                {submitBranchOptions.map((b) => (
                                                                    <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        <Button size="sm" onClick={handleChangeBranch} disabled={!newBranchId || changingBranch}>
                                                            {changingBranch ? 'Saving...' : 'Save'}
                                                        </Button>
                                                        <Button size="sm" variant="outline" onClick={() => setEditingBranch(false)} disabled={changingBranch}>Cancel</Button>
                                                    </div>
                                                )}
                                                {detailWorkflow && (
                                                    <Card>
                                                        <CardHeader className="pb-2"><CardTitle className="text-sm">Approval Timeline</CardTitle></CardHeader>
                                                        <CardContent>
                                                            <ul className="space-y-1.5">
                                                                {detailWorkflow.stages.map((stage) => (
                                                                    <li key={stage.stageId} className="text-sm flex items-center justify-between border-b pb-1.5">
                                                                        <span>{stage.stageOrder}. {stage.stageName} ({stage.approverRoleSlug})</span>
                                                                        <Badge variant={stage.status === 'APPROVED' ? 'default' : stage.status === 'REJECTED' ? 'destructive' : 'outline'}>
                                                                            {stage.status}
                                                                        </Badge>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </CardContent>
                                                    </Card>
                                                )}
                                                {canAct && !detailWorkflow && (
                                                    <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                                                        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                                                        Couldn&apos;t load stage info — refresh and try again before approving.
                                                    </div>
                                                )}
                                            </div>
                                        </TabsContent>
                                    </Tabs>
                                ) : (
                                    <div className="py-4 space-y-4">
                                        <h3 className="text-sm font-medium text-gray-500">Submitted Details</h3>
                                        <DetailInfoSections request={detailRow} />
                                        <OnboardingDocumentUploader requestId={detailId!} readOnly={detailRow.status === 'APPROVED'} allowDelete={false} allowDownload={false} />
                                    </div>
                                )}
                            </div>
                        )
                    )}

                    {!credentials && (canDirectlyFinalize || canAct) && (
                        <div className="space-y-3 pt-4 mt-4 border-t">
                            {canDirectlyFinalize && finalizeApproveDisabled && (
                                <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5">
                                    <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500" />
                                    <span>
                                        To approve, please fill in the required field{missingFinalizeFields.length > 1 ? 's' : ''} in Finalize Employee Details above: <strong>{missingFinalizeFields.join(', ')}</strong>.
                                    </span>
                                </div>
                            )}
                            <div className="flex items-center justify-end gap-2 flex-wrap">
                                {canAct && (
                                    <Button variant="outline" onClick={() => handleAction('send_back')} disabled={acting}>
                                        <Undo2 className="h-4 w-4 mr-2" /> Send Back
                                    </Button>
                                )}
                                {(canAct || canSubmitForApproval) && (
                                    <Button variant="destructive" onClick={() => handleAction('reject')} disabled={acting}>
                                        <XCircle className="h-4 w-4 mr-2" /> Reject
                                    </Button>
                                )}
                                {canDirectlyFinalize ? (
                                    <Button onClick={() => handleAction('approve')} disabled={acting || finalizeApproveDisabled} className="bg-primary text-white">
                                        {acting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                                        Approve &amp; Create Employee
                                    </Button>
                                ) : canAct ? (
                                    <Button onClick={() => handleAction('approve')} disabled={acting} className="bg-primary text-white">
                                        {acting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                                        Approve
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                    )}

                            </CardContent>
                        </Card>
                    </>
                )}
            </div>

            {/* ── Delete confirmation ── */}
            <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Delete Onboarding Request</DialogTitle></DialogHeader>
                    <p className="text-sm text-slate-600">
                        Delete the request for <span className="font-medium">{deleteTarget?.employeeName ?? 'this joinee'}</span>?
                        This also removes any documents attached to it. This cannot be undone.
                    </p>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
                        <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleting}>
                            {deleting ? 'Deleting...' : 'Delete'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Employee ID Card Modal ── */}
            <EmployeeIdCardModal
                open={idCardOpen}
                onOpenChange={(open) => {
                    setIdCardOpen(open);
                    if (!open) {
                        cardRequestIdRef.current = null;
                    }
                }}
                data={idCardData}
            />
            {/* Provisioned employees: live, eligibility-checked card (see openLiveIdCard). */}
            {liveIdCardDialogs}
        </div>
    );
}
