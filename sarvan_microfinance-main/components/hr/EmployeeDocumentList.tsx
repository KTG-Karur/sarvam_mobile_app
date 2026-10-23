'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
    FileCheck,
    Loader2,
    CheckCircle2,
    Clock,
    AlertCircle,
    ShieldCheck,
    Briefcase,
    FolderGit2,
} from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { DocumentPreviewModal, type DocumentPreviewTarget } from '@/components/hr/DocumentPreviewModal';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { usePermission } from '@/app/hooks/usePermission';
import { useAuthStore } from '@/app/store/authStore';
import {
    EmployeeDocumentSlotCard,
    type DocumentSlotDef,
} from '@/components/hr/EmployeeDocumentSlotCard';
import {
    type DocumentRow,
    categoryLabel,
} from '@/components/hr/DocumentThumbnail';

type EmployeeOption = {
    id: string;
    firstName: string;
    lastName: string;
    employeeId: string | null;
    branch?: { id?: string; name: string; code?: string } | null;
};

// 15 predefined slots matching app/lib/hr/document-order.ts DOCUMENT_SLOT_ORDER
export const STANDARD_SLOTS: DocumentSlotDef[] = [
    // 1. KYC & Identity (6 single-copy slots)
    { id: 'KYC_Aadhaar', title: 'Aadhaar', category: 'KYC', subtype: 'Aadhaar', group: 'kyc', imageCategory: 'document' },
    { id: 'KYC_PAN', title: 'PAN Card', category: 'KYC', subtype: 'PAN', group: 'kyc', imageCategory: 'document' },
    { id: 'KYC_DL', title: 'DL / LLR', category: 'KYC', subtype: 'DL / LLR', group: 'kyc', imageCategory: 'document' },
    { id: 'KYC_VoterID', title: 'Voter ID', category: 'KYC', subtype: 'Voter ID', group: 'kyc', imageCategory: 'document' },
    { id: 'KYC_UAN', title: 'UAN', category: 'KYC', subtype: 'UAN', group: 'kyc', imageCategory: 'document' },
    { id: 'KYC_Photo', title: 'Passport Photo', category: 'KYC', subtype: 'Photo', group: 'kyc', imageCategory: 'portrait' },

    // 2. Education & Employment (5 slots)
    { id: 'RESUME', title: 'Resume / CV', category: 'RESUME', subtype: null, group: 'academic' },
    { id: 'EDUCATION_CERTIFICATE', title: 'Education Certificate', category: 'EDUCATION_CERTIFICATE', subtype: null, group: 'academic', allowMultiple: true },
    { id: 'PRE_APPLICATION_ASSESSMENT', title: 'Pre-Application Assessment', category: 'PRE_APPLICATION_ASSESSMENT', subtype: null, group: 'academic' },
    { id: 'BANK_PASSBOOK', title: 'Bank Passbook / Cheque', category: 'BANK_PASSBOOK', subtype: null, group: 'academic' },
    { id: 'RELIEVING_LETTER_PAYSLIP', title: 'Relieving Letter / Payslip', category: 'RELIEVING_LETTER_PAYSLIP', subtype: null, group: 'academic', allowMultiple: true },

    // 3. HR & Company Documents (4 slots)
    { id: 'JOINING_KIT', title: 'Joining Kit', category: 'JOINING_KIT', subtype: null, group: 'hr' },
    { id: 'APPOINTMENT_LETTER', title: 'Appointment Letter', category: 'APPOINTMENT_LETTER', subtype: null, group: 'hr' },
    { id: 'BGV_REPORT', title: 'BGV Report', category: 'BGV_REPORT', subtype: null, group: 'hr' },
    { id: 'ORIGINAL_CERTIFICATE_ACK', title: 'Original Certificate Ack', category: 'ORIGINAL_CERTIFICATE_ACK', subtype: null, group: 'hr' },
];

// Column count follows the width of the documents area itself (a container
// query), not the browser window — viewport breakpoints ignore the sidebar,
// so zooming out used to jump to 4 columns too narrow for the card actions.
// 1 → 2 → 3 → 4 columns at 600 / 900 / 1240px of available width, so a card
// is never narrower than ~290px. Pixel thresholds on purpose: rem-based ones
// shift with the brand font-size setting.
function DocumentSlotGrid({ children }: { children: React.ReactNode }) {
    return (
        <div className="@container">
            <div className="grid grid-cols-1 gap-4 @[600px]:grid-cols-2 @[900px]:grid-cols-3 @[1240px]:grid-cols-4">
                {children}
            </div>
        </div>
    );
}

export function EmployeeDocumentList() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const employeeId = searchParams.get('employeeId') || '';
    const { toast } = useToast();

    const currentUserId = useAuthStore((s) => s.user?.id);
    const { can } = usePermission();
    const canDelete = can('hr-employee', 'delete');
    const canVerify = can('hr-employee', 'verify');

    const [employees, setEmployees] = useState<EmployeeOption[]>([]);
    const [loadingEmployees, setLoadingEmployees] = useState(true);

    const [documents, setDocuments] = useState<DocumentRow[]>([]);
    const [isInitialLoading, setIsInitialLoading] = useState(false);

    // Dialog state for preview, rejection, and deletion
    const [previewTarget, setPreviewTarget] = useState<DocumentPreviewTarget | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<DocumentRow | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const [rejectTarget, setRejectTarget] = useState<DocumentRow | null>(null);
    const [rejectionReason, setRejectionReason] = useState('');
    const [isRejecting, setIsRejecting] = useState(false);

    // Fetch employee list for selector
    useEffect(() => {
        const fetchEmployees = async () => {
            try {
                const res = await apiClient.get<EmployeeOption[]>('/hr/employees');
                if (res.success && res.data) {
                    setEmployees(res.data);
                }
            } catch {
                toast({ title: 'Error', description: 'Failed to load employees.', variant: 'destructive' });
            } finally {
                setLoadingEmployees(false);
            }
        };
        void fetchEmployees();
    }, [toast]);

    // Fetch documents for selected employee
    const fetchDocuments = useCallback(async () => {
        if (!employeeId) {
            setDocuments([]);
            setIsInitialLoading(false);
            return;
        }
        setIsInitialLoading(true);
        try {
            const res = await apiClient.get<DocumentRow[]>(`/hr/employee-documents?employeeId=${employeeId}`);
            if (res.success && res.data) setDocuments(res.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch documents.', variant: 'destructive' });
        } finally {
            setIsInitialLoading(false);
        }
    }, [employeeId, toast]);

    useEffect(() => {
        void fetchDocuments();
    }, [fetchDocuments]);

    const selectedEmployee = employees.find((e) => e.id === employeeId);

    // ─── ACTION HANDLERS ────────────────────────────────────────────────────────

    // Direct slot upload (POST /api/hr/employee-documents)
    const handleSlotUpload = async (file: File, category: string, subtype: string | null) => {
        if (!employeeId) return;
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('employeeId', employeeId);
            formData.append('category', category);
            if (subtype) formData.append('subtype', subtype);

            const res = await apiClient.post('/hr/employee-documents', formData);
            if (res.success) {
                toast({ title: 'Uploaded', description: 'Document uploaded successfully.' });
                await fetchDocuments();
            } else {
                throw new Error(res.error || 'Upload failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Upload failed.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        }
    };

    // Replace in-place (PUT /api/hr/employee-documents/[id])
    const handleReplace = async (file: File, documentId: string) => {
        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await apiClient.put(`/hr/employee-documents/${documentId}`, formData);
            if (res.success) {
                toast({ title: 'Updated', description: 'Document replaced successfully.' });
                await fetchDocuments();
            } else {
                throw new Error(res.error || 'Update failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to update document.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        }
    };

    // Verify document (POST /api/hr/employee-documents/[id]/verify)
    const handleVerify = async (doc: DocumentRow) => {
        try {
            const res = await apiClient.post(`/hr/employee-documents/${doc.id}/verify`);
            if (res.success) {
                toast({ title: 'Verified', description: `${doc.fileName} verified successfully.` });
                await fetchDocuments();
            } else {
                throw new Error(res.error || 'Verification failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to verify document.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        }
    };

    // Submit rejection (POST /api/hr/employee-documents/[id]/reject)
    const handleRejectSubmit = async () => {
        if (!rejectTarget || !rejectionReason.trim()) {
            toast({ title: 'Validation Error', description: 'Please provide a rejection reason.', variant: 'destructive' });
            return;
        }
        setIsRejecting(true);
        try {
            const res = await apiClient.post(`/hr/employee-documents/${rejectTarget.id}/reject`, {
                rejectionReason: rejectionReason.trim(),
            });
            if (res.success) {
                toast({ title: 'Rejected', description: `${rejectTarget.fileName} marked as rejected.` });
                setRejectTarget(null);
                setRejectionReason('');
                await fetchDocuments();
            } else {
                throw new Error(res.error || 'Rejection failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to reject document.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setIsRejecting(false);
        }
    };

    // Delete document (DELETE /api/hr/employee-documents/[id])
    const handleDeleteConfirm = async () => {
        if (!deleteTarget) return;
        setIsDeleting(true);
        try {
            const res = await apiClient.delete(`/hr/employee-documents/${deleteTarget.id}`);
            if (res.success) {
                toast({ title: 'Deleted', description: `${deleteTarget.fileName} deleted successfully.` });
                setDeleteTarget(null);
                await fetchDocuments();
            } else {
                throw new Error(res.error || 'Delete failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to delete document.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setIsDeleting(false);
        }
    };

    // Download document via signed URL
    const handleDownload = async (fileUrl: string) => {
        try {
            const res = await apiClient.get<{ url: string }>(`/storage/signed-url?key=${encodeURIComponent(fileUrl)}`);
            if (res.success && res.data?.url) {
                window.open(res.data.url, '_blank', 'noopener,noreferrer');
            } else {
                toast({ title: 'Error', description: 'Could not resolve download URL.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Could not resolve download URL.', variant: 'destructive' });
        }
    };

    // Preview in DocumentPreviewModal
    const handlePreview = (doc: DocumentRow) => {
        const title = doc.subtype ? `${categoryLabel(doc.category)} › ${doc.subtype}` : categoryLabel(doc.category);
        setPreviewTarget({
            title,
            fileUrl: doc.fileUrl,
            fileName: doc.fileName,
            mimeType: doc.mimeType,
        });
    };

    // ─── DERIVED SLOT & STATISTICS STATE ───────────────────────────────────────

    // Map matching documents to slots
    const slotDocMap = new Map<string, DocumentRow[]>();
    let uploadedSlots = 0;

    for (const slot of STANDARD_SLOTS) {
        const matching = documents.filter(
            (d) => d.category === slot.category && (slot.subtype ? d.subtype === slot.subtype : true)
        );
        slotDocMap.set(slot.id, matching);
        if (matching.length > 0) {
            uploadedSlots++;
        }
    }

    const totalSlots = STANDARD_SLOTS.length; // 15
    const missingSlots = totalSlots - uploadedSlots;
    const progressPercent = Math.round((uploadedSlots / totalSlots) * 100);

    // Actual counts from fetched documents
    const verifiedCount = documents.filter((d) => d.status === 'VERIFIED').length;
    const pendingCount = documents.filter((d) => d.status === 'PENDING').length;
    const rejectedCount = documents.filter((d) => d.status === 'REJECTED').length;

    // Group slots
    const kycSlots = STANDARD_SLOTS.filter((s) => s.group === 'kyc');
    const academicSlots = STANDARD_SLOTS.filter((s) => s.group === 'academic');
    const hrSlots = STANDARD_SLOTS.filter((s) => s.group === 'hr');

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-7xl space-y-6">
                {/* ─── EMPLOYEE HEADER & SELECTOR ─────────────────────────────────── */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-2xl bg-white/80 dark:bg-brand-green-darker/40 border border-primary/20 dark:border-sidebar-accent shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-white shadow-md shadow-primary/20 shrink-0">
                            <FileCheck className="h-6 w-6" />
                        </div>
                        <div>
                            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground dark:text-white">
                                Employee Documents
                            </h1>
                            {selectedEmployee ? (
                                <p className="text-sm font-medium text-muted-foreground mt-0.5">
                                    <span className="font-semibold text-foreground dark:text-slate-200">
                                        {selectedEmployee.firstName} {selectedEmployee.lastName}
                                    </span>
                                    {selectedEmployee.employeeId && (
                                        <span className="font-mono text-primary dark:text-emerald-400 font-bold ml-1.5">
                                            ({selectedEmployee.employeeId})
                                        </span>
                                    )}
                                    {selectedEmployee.branch?.name && (
                                        <span className="text-muted-foreground ml-1.5">
                                            · {selectedEmployee.branch.name}
                                        </span>
                                    )}
                                </p>
                            ) : (
                                <p className="text-xs sm:text-sm text-sidebar-accent dark:text-slate-400 mt-0.5">
                                    Select an employee to manage their document portfolio.
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="w-full sm:w-80">
                        <Select
                            value={employeeId}
                            onValueChange={(val) => {
                                if (val) {
                                    router.replace(`${pathname}?employeeId=${val}`);
                                } else {
                                    router.replace(pathname);
                                }
                            }}
                            disabled={loadingEmployees}
                        >
                            <SelectTrigger className="w-full bg-white dark:bg-slate-900 border-primary/30">
                                {loadingEmployees ? (
                                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        <span>Loading employees...</span>
                                    </div>
                                ) : (
                                    <SelectValue placeholder="Choose an employee..." />
                                )}
                            </SelectTrigger>
                            <SelectContent className="max-h-72">
                                {employees.map((e) => (
                                    <SelectItem key={e.id} value={e.id}>
                                        {e.firstName} {e.lastName} {e.employeeId ? `(${e.employeeId})` : ''} {e.branch?.name ? `· ${e.branch.name}` : ''}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* ─── EMPTY STATE: NO EMPLOYEE SELECTED ───────────────────────── */}
                {!employeeId ? (
                    <Card className="border-dashed border-2 border-primary/20 bg-white/60 p-12 text-center shadow-sm dark:bg-brand-green-darker/20 dark:border-sidebar-accent">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-4">
                            <FileCheck className="h-7 w-7" />
                        </div>
                        <h3 className="text-lg font-semibold text-foreground dark:text-white">No Employee Selected</h3>
                        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                            Please select an employee using the dropdown above to view, upload, and review their documents.
                        </p>
                    </Card>
                ) : isInitialLoading ? (
                    <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 p-12 text-center">
                        <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">Loading employee documents...</p>
                    </Card>
                ) : (
                    <>
                        {/* ─── DOCUMENT SUMMARY CARD ───────────────────────────────── */}
                        <Card className="border border-primary/20 dark:border-sidebar-accent bg-white/90 dark:bg-brand-green-darker/40 shadow-sm p-5 space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div>
                                    <h3 className="text-base font-semibold text-foreground dark:text-white">
                                        Document Summary
                                    </h3>
                                    <p className="text-xs text-muted-foreground">
                                        {uploadedSlots} of {totalSlots} document slots filled ({documents.length} total files)
                                    </p>
                                </div>

                                {/* Status Counts Summary */}
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        <span>Verified</span>
                                        <span className="font-mono bg-emerald-200/60 dark:bg-emerald-900/60 px-1.5 py-0.2 rounded text-[11px]">{verifiedCount}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-300 text-xs font-semibold">
                                        <Clock className="h-3.5 w-3.5" />
                                        <span>Pending</span>
                                        <span className="font-mono bg-amber-200/60 dark:bg-amber-900/60 px-1.5 py-0.2 rounded text-[11px]">{pendingCount}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold">
                                        <AlertCircle className="h-3.5 w-3.5" />
                                        <span>Empty Slots</span>
                                        <span className="font-mono bg-slate-200 dark:bg-slate-700 px-1.5 py-0.2 rounded text-[11px]">{missingSlots}</span>
                                    </div>
                                    {rejectedCount > 0 && (
                                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300 text-xs font-semibold">
                                            <AlertCircle className="h-3.5 w-3.5" />
                                            <span>Rejected</span>
                                            <span className="font-mono bg-red-200/60 dark:bg-red-900/60 px-1.5 py-0.2 rounded text-[11px]">{rejectedCount}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Styled Visual Progress Bar */}
                            <div className="space-y-1.5">
                                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                    <div
                                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-primary to-emerald-600 transition-all duration-500"
                                        style={{ width: `${progressPercent}%` }}
                                    />
                                </div>
                                <div className="flex justify-between text-[11px] text-muted-foreground font-medium">
                                    <span>{uploadedSlots} of {totalSlots} document slots filled</span>
                                    <span>{progressPercent}% slots filled</span>
                                </div>
                            </div>
                        </Card>

                        {/* ─── GROUP 1: KYC & IDENTITY (EMPLOYEE-SUBMITTED) ────────── */}
                        <div className="space-y-3">
                            <div>
                                <div className="flex items-center gap-2">
                                    <ShieldCheck className="h-5 w-5 text-primary" />
                                    <h3 className="text-base font-semibold text-foreground dark:text-white">
                                        KYC & Identity
                                    </h3>
                                    <Badge variant="outline" className="text-xs font-normal border-primary/30">
                                        {kycSlots.filter((s) => (slotDocMap.get(s.id)?.length || 0) > 0).length} / {kycSlots.length}
                                    </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Employee-submitted documents · Strict single-copy identity proofs
                                </p>
                            </div>
                            <DocumentSlotGrid>
                                {kycSlots.map((slot) => (
                                    <EmployeeDocumentSlotCard
                                        key={slot.id}
                                        slot={slot}
                                        documents={slotDocMap.get(slot.id) || []}
                                        onUpload={handleSlotUpload}
                                        onReplace={handleReplace}
                                        onDelete={setDeleteTarget}
                                        onPreview={handlePreview}
                                        onDownload={handleDownload}
                                        onVerify={handleVerify}
                                        onReject={setRejectTarget}
                                        canDelete={canDelete}
                                        canVerify={canVerify}
                                        currentUserId={currentUserId}
                                    />
                                ))}
                            </DocumentSlotGrid>
                        </div>

                        {/* ─── GROUP 2: EDUCATION & EMPLOYMENT (EMPLOYEE-SUBMITTED) ─── */}
                        <div className="space-y-3 pt-2">
                            <div>
                                <div className="flex items-center gap-2">
                                    <Briefcase className="h-5 w-5 text-primary" />
                                    <h3 className="text-base font-semibold text-foreground dark:text-white">
                                        Education & Employment
                                    </h3>
                                    <Badge variant="outline" className="text-xs font-normal border-primary/30">
                                        {academicSlots.filter((s) => (slotDocMap.get(s.id)?.length || 0) > 0).length} / {academicSlots.length}
                                    </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Employee-submitted documents · Academic credentials and prior work history
                                </p>
                            </div>
                            <DocumentSlotGrid>
                                {academicSlots.map((slot) => (
                                    <EmployeeDocumentSlotCard
                                        key={slot.id}
                                        slot={slot}
                                        documents={slotDocMap.get(slot.id) || []}
                                        onUpload={handleSlotUpload}
                                        onReplace={handleReplace}
                                        onDelete={setDeleteTarget}
                                        onPreview={handlePreview}
                                        onDownload={handleDownload}
                                        onVerify={handleVerify}
                                        onReject={setRejectTarget}
                                        canDelete={canDelete}
                                        canVerify={canVerify}
                                        currentUserId={currentUserId}
                                    />
                                ))}
                            </DocumentSlotGrid>
                        </div>

                        {/* ─── GROUP 3: HR & COMPANY DOCUMENTS (COMPANY-MANAGED) ───── */}
                        <div className="space-y-3 pt-2">
                            <div>
                                <div className="flex items-center gap-2">
                                    <FolderGit2 className="h-5 w-5 text-primary" />
                                    <h3 className="text-base font-semibold text-foreground dark:text-white">
                                        HR & Company Documents
                                    </h3>
                                    <Badge variant="outline" className="text-xs font-normal border-primary/30">
                                        {hrSlots.filter((s) => (slotDocMap.get(s.id)?.length || 0) > 0).length} / {hrSlots.length}
                                    </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Company-managed documents · Internal records and certificates issued by HR
                                </p>
                            </div>
                            <DocumentSlotGrid>
                                {hrSlots.map((slot) => (
                                    <EmployeeDocumentSlotCard
                                        key={slot.id}
                                        slot={slot}
                                        documents={slotDocMap.get(slot.id) || []}
                                        onUpload={handleSlotUpload}
                                        onReplace={handleReplace}
                                        onDelete={setDeleteTarget}
                                        onPreview={handlePreview}
                                        onDownload={handleDownload}
                                        onVerify={handleVerify}
                                        onReject={setRejectTarget}
                                        canDelete={canDelete}
                                        canVerify={canVerify}
                                        currentUserId={currentUserId}
                                    />
                                ))}
                            </DocumentSlotGrid>
                        </div>
                    </>
                )}
            </div>

            {/* ─── PREVIEW MODAL ─────────────────────────────────────────────────── */}
            <DocumentPreviewModal
                open={!!previewTarget}
                onOpenChange={(open) => {
                    if (!open) setPreviewTarget(null);
                }}
                document={previewTarget}
                onDownload={previewTarget ? () => handleDownload(previewTarget.fileUrl) : undefined}
            />

            {/* ─── DELETE CONFIRMATION DIALOG ────────────────────────────────────── */}
            <ConfirmationDialog
                open={!!deleteTarget}
                onOpenChange={(open) => {
                    if (!open && !isDeleting) setDeleteTarget(null);
                }}
                onConfirm={handleDeleteConfirm}
                type="delete"
                title="Delete Document"
                description={
                    deleteTarget
                        ? `Delete ${deleteTarget.fileName}? This will permanently remove the file and cannot be undone.`
                        : ''
                }
                confirmText="Delete"
                isLoading={isDeleting}
            />

            {/* ─── REJECT REASON DIALOG ──────────────────────────────────────────── */}
            <Dialog
                open={!!rejectTarget}
                onOpenChange={(open) => {
                    if (!open && !isRejecting) {
                        setRejectTarget(null);
                        setRejectionReason('');
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Reject Document</DialogTitle>
                        <DialogDescription>
                            Please provide a reason for rejecting {rejectTarget?.fileName}. This reason will be recorded and visible on the document card.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <Label htmlFor="rejection-reason">Rejection Reason</Label>
                        <Textarea
                            id="rejection-reason"
                            placeholder="e.g. Blurred text, incorrect name, expired document..."
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            rows={3}
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setRejectTarget(null);
                                setRejectionReason('');
                            }}
                            disabled={isRejecting}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleRejectSubmit}
                            disabled={isRejecting || !rejectionReason.trim()}
                        >
                            {isRejecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                            Reject Document
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
