'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Banknote,
    BookOpen,
    CheckCircle2,
    CheckSquare,
    Eye,
    FileText,
    ListOrdered,
    Loader2,
    Pencil,
    RefreshCw,
    ShieldCheck,
    Upload,
    XCircle,
} from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import {
    previewInstallments,
    type ApplicationDetail,
    type ApplicationList,
    type ApplicationRow,
    type ManagementCapabilities,
} from '@/app/lib/staff-loans/application';
import { compressImageForCategory, formatBytes } from '@/app/lib/image-compress';
import { STAFF_LOAN_DOCUMENT_ACCEPT, STAFF_LOAN_DOCUMENT_MAX_BYTES } from '@/app/lib/staff-loans/document-rule';
import {
    buildSalaryDueDates, defaultFirstDueMonth, firstSalaryDueDate, isValidSalaryDay, type FirstDueMonth,
} from '@/app/lib/staff-loans/salary-schedule';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageLoader } from '@/components/ui/page-loader';

import {
    EmployeePanel, Field, PastLoansTable, RepaymentTrackTable, SectionTitle,
    formatCurrency, formatDateTime as formatDate,
} from './StaffLoanDetailParts';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

const interestRateLabel = (loan: { interestType: string; annualInterestRate: number }) =>
    loan.interestType === 'INTEREST_FREE' ? 'Interest-free'
        : loan.interestType === 'MONTHLY' ? `${loan.annualInterestRate}% monthly`
        : `${loan.annualInterestRate}% flat p.a.`;

type TabKey = 'register' | 'approvals' | 'disbursements';

// Business dates are Indian calendar dates: derive "today" in Asia/Kolkata, not from the UTC clock.
const todayInKolkata = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

const formatDueDate = (ymd: string) =>
    `${new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })}, ${toDisplayDate(ymd)}`;

export default function StaffLoanManagementPage() {
    const { toast } = useToast();

    // Capabilities
    const [capabilities, setCapabilities] = useState<ManagementCapabilities | null>(null);
    const [capsLoading, setCapsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabKey>('register');

    // List state
    const [listData, setListData] = useState<ApplicationList | null>(null);
    const [listLoading, setListLoading] = useState(true);
    const [page, setPage] = useState(1);

    // Detail modal
    const [viewId, setViewId] = useState<string | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailData, setDetailData] = useState<ApplicationDetail | null>(null);

    // Review dialog
    const [reviewingLoan, setReviewingLoan] = useState<ApplicationRow | null>(null);
    const [reviewAction, setReviewAction] = useState<'APPROVE' | 'REJECT'>('APPROVE');
    const [reviewDetail, setReviewDetail] = useState<ApplicationDetail | null>(null);
    const [reviewLoading, setReviewLoading] = useState(false);
    const [editingTerms, setEditingTerms] = useState(false);
    const [editSchemeId, setEditSchemeId] = useState('');
    const [editAmount, setEditAmount] = useState('');
    const [editTenure, setEditTenure] = useState('');
    const [editInterestType, setEditInterestType] = useState<'INTEREST_FREE' | 'FLAT' | 'MONTHLY'>('FLAT');
    const [editRate, setEditRate] = useState('');
    const [editRecovery, setEditRecovery] = useState<'SALARY' | 'CASH_BANK'>('SALARY');
    const [editPurpose, setEditPurpose] = useState('');
    const [editRemarks, setEditRemarks] = useState('');
    const [editReason, setEditReason] = useState('');
    const [editDocument, setEditDocument] = useState<{ fileKey: string; fileName: string; fileSize: number } | null>(null);
    const [editUploading, setEditUploading] = useState(false);
    const [editError, setEditError] = useState('');
    const [editSaving, setEditSaving] = useState(false);
    const [showTrack, setShowTrack] = useState(false);
    const editDocumentInput = useRef<HTMLInputElement>(null);

    const editSchemes = reviewDetail?.editOptions?.schemes ?? [];
    const editScheme = editSchemes.find(option => option.id === editSchemeId);

    // Live recalculation while an approver edits the terms (same calculation the schedule is built from)
    const editPreview = useMemo(() => {
        if (!editingTerms) return null;
        try {
            return previewInstallments(Number(editAmount), Number(editTenure), editInterestType, Number(editRate));
        } catch {
            return null;
        }
    }, [editingTerms, editAmount, editTenure, editInterestType, editRate]);
    const [reviewRemarks, setReviewRemarks] = useState('');
    const [reviewSubmitting, setReviewSubmitting] = useState(false);

    // Disburse dialog
    const [disbursingLoan, setDisbursingLoan] = useState<ApplicationRow | null>(null);
    const [disburseDate, setDisburseDate] = useState('');
    const [paymentMode, setPaymentMode] = useState<'CASH' | 'BANK_TRANSFER'>('BANK_TRANSFER');
    const [reference, setReference] = useState('');
    const [firstDueDate, setFirstDueDate] = useState('');
    const [firstDueMonth, setFirstDueMonth] = useState<FirstDueMonth>('NEXT_MONTH');
    const [disburseRemarks, setDisburseRemarks] = useState('');
    const [disburseSubmitting, setDisburseSubmitting] = useState(false);

    // A bank transfer must carry its UTR / transaction reference.
    const referenceRequired = paymentMode === 'BANK_TRANSFER';
    const referenceMissing = referenceRequired && !reference.trim();

    // Salary date from the workflow master (disbursements tab list response); null until an admin sets it.
    const configuredSalaryDay = listData?.salaryDay;
    const salaryDay: number | null = isValidSalaryDay(configuredSalaryDay) ? configuredSalaryDay : null;
    const thisMonthAvailable = salaryDay !== null && !!disburseDate && firstSalaryDueDate(disburseDate, 'THIS_MONTH', salaryDay) >= disburseDate;
    const effectiveFirstDueMonth: FirstDueMonth = firstDueMonth === 'THIS_MONTH' && !thisMonthAvailable ? 'NEXT_MONTH' : firstDueMonth;
    const dueDatePreview = salaryDay !== null && disbursingLoan && disburseDate
        ? buildSalaryDueDates(disburseDate, effectiveFirstDueMonth, salaryDay, disbursingLoan.tenureMonths)
        : [];

    // Load capabilities
    const loadCapabilities = useCallback(async () => {
        setCapsLoading(true);
        try {
            const res = await apiClient.get<ManagementCapabilities>('/hr/staff-loans/capabilities');
            if (!res.success || !res.data) throw new Error(res.error || 'Failed to load permissions');
            const caps = res.data;
            setCapabilities(caps);

            // Determine initial active tab
            if (caps.register) {
                setActiveTab('register');
            } else if (caps.approvals) {
                setActiveTab('approvals');
            } else if (caps.disbursements) {
                setActiveTab('disbursements');
            }
        } catch (err) {
            toast({
                title: 'Access Error',
                description: err instanceof Error ? err.message : 'Unable to determine loan management permissions',
                variant: 'destructive',
            });
        } finally {
            setCapsLoading(false);
        }
    }, [toast]);

    // Load list for current tab
    const loadList = useCallback(async (tab: TabKey, targetPage = 1) => {
        if (capabilities && !capabilities[tab]) {
            setListData(null);
            return;
        }
        setListLoading(true);
        try {
            const res = await apiClient.get<ApplicationList>(`/hr/staff-loans?tab=${tab}&page=${targetPage}`);
            if (!res.success || !res.data) throw new Error(res.error || 'Failed to load loan list');
            setListData(res.data);
            setPage(targetPage);
        } catch (err) {
            toast({
                title: 'Error',
                description: err instanceof Error ? err.message : 'Failed to load applications',
                variant: 'destructive',
            });
        } finally {
            setListLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        void loadCapabilities();
    }, [loadCapabilities]);

    useEffect(() => {
        if (capabilities) {
            void loadList(activeTab, 1);
        }
    }, [capabilities, activeTab, loadList]);

    // Load Detail Modal
    const handleViewDocument = async (loanId: string) => {
        const res = await apiClient.get<{ url: string }>(`/hr/staff-loans/${loanId}/document`);
        if (res.success && res.data?.url) window.open(res.data.url, '_blank', 'noopener,noreferrer');
        else toast({ title: 'Error', description: res.error || 'Could not open the document.', variant: 'destructive' });
    };

    const handleViewDetail = async (id: string) => {
        setViewId(id);
        setShowTrack(false);
        setDetailLoading(true);
        try {
            const res = await apiClient.get<ApplicationDetail>(`/hr/staff-loans/${id}`);
            if (!res.success || !res.data) throw new Error(res.error || 'Failed to load details');
            setDetailData(res.data);
        } catch (err) {
            toast({
                title: 'Error',
                description: err instanceof Error ? err.message : 'Unable to load loan details',
                variant: 'destructive',
            });
            setViewId(null);
        } finally {
            setDetailLoading(false);
        }
    };

    const closeDetail = () => { setViewId(null); setDetailData(null); setShowTrack(false); };

    // Review modal: loads the full detail (employee profile, terms) so the approver can decide in one place
    const loadReviewDetail = async (id: string) => {
        setReviewLoading(true);
        try {
            const res = await apiClient.get<ApplicationDetail>(`/hr/staff-loans/${id}`);
            if (!res.success || !res.data) throw new Error(res.error || 'Failed to load the application');
            setReviewDetail(res.data);
        } catch (err) {
            toast({
                title: 'Error',
                description: err instanceof Error ? err.message : 'Unable to load the application',
                variant: 'destructive',
            });
            setReviewingLoan(null);
        } finally {
            setReviewLoading(false);
        }
    };

    // Shown under the form and as a toast, so the message is seen wherever the user is looking.
    const reportEditError = (message: string) => {
        setEditError(message);
        toast({ title: 'Error', description: message, variant: 'destructive' });
    };

    const openReview = (loan: ApplicationRow) => {
        setReviewingLoan(loan);
        setReviewAction('APPROVE');
        setReviewRemarks('');
        setReviewDetail(null);
        setEditingTerms(false);
        void loadReviewDetail(loan.id);
    };

    const closeReview = () => {
        setReviewingLoan(null);
        setReviewDetail(null);
        setEditingTerms(false);
    };

    const startEditTerms = () => {
        if (!reviewDetail) return;
        setEditSchemeId(reviewDetail.schemeId);
        setEditAmount(String(reviewDetail.requestedAmount));
        setEditTenure(String(reviewDetail.tenureMonths));
        setEditInterestType(reviewDetail.interestType);
        setEditRate(String(reviewDetail.annualInterestRate));
        setEditRecovery(reviewDetail.recoveryMethod);
        setEditPurpose(reviewDetail.purpose);
        setEditRemarks(reviewDetail.remarks ?? '');
        setEditReason('');
        setEditDocument(null);
        setEditError('');
        setEditingTerms(true);
    };

    // Moving to another scheme brings that scheme's interest terms as the starting point (still editable).
    const handleEditSchemeChange = (id: string) => {
        setEditSchemeId(id);
        const option = editSchemes.find(o => o.id === id);
        if (option) {
            setEditInterestType(option.interestType);
            setEditRate(option.interestType === 'INTEREST_FREE' ? '0' : String(option.annualInterestRate));
        }
    };

    const handleEditInterestTypeChange = (type: 'INTEREST_FREE' | 'FLAT' | 'MONTHLY') => {
        setEditInterestType(type);
        if (type === 'INTEREST_FREE') setEditRate('0');
        else if (Number(editRate) <= 0) setEditRate(editScheme && editScheme.interestType === type ? String(editScheme.annualInterestRate) : '');
    };

    // Replacement document: images are compressed in the browser first; the server validates the real
    // type and compresses again. The file goes into the borrower's folder (server checks reviewer rights).
    const handleEditDocumentPicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const picked = event.target.files?.[0];
        event.target.value = '';
        if (!picked || !reviewDetail) return;
        const isPdf = picked.type === 'application/pdf';
        const isImage = picked.type === 'image/jpeg' || picked.type === 'image/png';
        if (!isPdf && !isImage) return reportEditError('Only JPG, PNG or PDF files are allowed');
        setEditUploading(true);
        setEditError('');
        try {
            let toUpload = picked;
            if (isImage) {
                const result = await compressImageForCategory(picked, 'document');
                URL.revokeObjectURL(result.previewUrl);
                toUpload = result.compressedFile;
            }
            if (toUpload.size > STAFF_LOAN_DOCUMENT_MAX_BYTES) throw new Error(`The file is too large (${formatBytes(toUpload.size)}). Maximum size is ${formatBytes(STAFF_LOAN_DOCUMENT_MAX_BYTES)}.`);
            const form = new FormData();
            form.append('file', toUpload);
            form.append('loanId', reviewDetail.id);
            const res = await apiClient.post<{ fileKey: string; fileName: string; fileSize: number }>('/hr/staff-loans/documents/upload', form);
            if (!res.success || !res.data) throw new Error(res.error || 'Failed to upload the document');
            setEditDocument({ fileKey: res.data.fileKey, fileName: res.data.fileName, fileSize: res.data.fileSize });
        } catch (err) {
            reportEditError(err instanceof Error ? err.message : 'Failed to upload the document');
        } finally {
            setEditUploading(false);
        }
    };

    const handleSaveTerms = async () => {
        if (!reviewDetail) return;
        const amount = Number(editAmount);
        const tenure = Number(editTenure);
        const rate = Number(editRate);
        if (!editSchemeId) return reportEditError('Select a scheme');
        if (editSchemeId !== reviewDetail.schemeId && editScheme?.eligibilityError) return reportEditError(editScheme.eligibilityError);
        if (!editAmount.trim() || !Number.isFinite(amount) || amount <= 0) return reportEditError('Enter a valid positive loan amount');
        if (!/^\d+(\.\d{1,2})?$/.test(editAmount.trim())) return reportEditError('Amount cannot have more than 2 decimal places');
        if (editScheme?.maximumAmount != null && amount > editScheme.maximumAmount) return reportEditError(`Amount exceeds the scheme limit of ${formatCurrency(editScheme.maximumAmount)}`);
        if (!editTenure.trim() || !Number.isInteger(tenure) || tenure < 1) return reportEditError('Enter a valid tenure in full months');
        if (editScheme && tenure > editScheme.maximumTenureMonths) return reportEditError(`Tenure exceeds the scheme limit of ${editScheme.maximumTenureMonths} months`);
        if (editInterestType !== 'INTEREST_FREE' && (!Number.isFinite(rate) || rate <= 0)) return reportEditError('Enter a positive interest rate');
        if (!editPurpose.trim()) return reportEditError('Loan purpose is required');

        setEditError('');
        setEditSaving(true);
        try {
            const res = await apiClient.patch(`/hr/staff-loans/${reviewDetail.id}`, {
                expectedVersion: reviewDetail.version,
                schemeId: editSchemeId,
                requestedAmount: amount,
                tenureMonths: tenure,
                interestType: editInterestType,
                annualInterestRate: editInterestType === 'INTEREST_FREE' ? 0 : rate,
                recoveryMethod: editRecovery,
                purpose: editPurpose.trim(),
                remarks: editRemarks.trim(),
                ...(editDocument ? { document: { fileKey: editDocument.fileKey, fileName: editDocument.fileName } } : {}),
                reason: editReason.trim(),
            });
            if (!res.success) throw new Error(res.error || 'Unable to update the loan details');
            toast({ title: 'Loan Updated', description: 'The loan details were updated and recorded in the audit trail.' });
            setEditingTerms(false);
            await loadReviewDetail(reviewDetail.id);
            void loadList(activeTab, page);
        } catch (err) {
            reportEditError(err instanceof Error ? err.message : 'Unable to update the loan details');
        } finally {
            setEditSaving(false);
        }
    };

    // Submit Review Action
    const handleSubmitReview = async () => {
        if (!reviewingLoan || !reviewDetail) return;

        if (reviewAction === 'REJECT' && !reviewRemarks.trim()) {
            toast({
                title: 'Remarks Required',
                description: 'Please enter a reason for rejecting this application.',
                variant: 'destructive',
            });
            return;
        }

        setReviewSubmitting(true);
        try {
            const res = await apiClient.post('/hr/staff-loans/review', {
                id: reviewingLoan.id,
                expectedVersion: reviewDetail.version,
                action: reviewAction,
                remarks: reviewRemarks.trim(),
            });

            if (!res.success) throw new Error(res.error || 'Review recording failed');

            toast({
                title: 'Decision Recorded',
                description: `Application ${reviewingLoan.loanNumber} has been ${reviewAction === 'APPROVE' ? 'approved' : 'rejected'}.`,
            });

            closeReview();
            void loadList(activeTab, page);
        } catch (err) {
            toast({
                title: 'Review Failed',
                description: err instanceof Error ? err.message : 'Another user may have modified this loan. Please refresh.',
                variant: 'destructive',
            });
        } finally {
            setReviewSubmitting(false);
        }
    };

    // Open Disburse Modal
    const openDisburse = (loan: ApplicationRow) => {
        setDisbursingLoan(loan);
        const today = todayInKolkata();
        const nextMonth = new Date(`${today}T00:00:00Z`);
        nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
        setDisburseDate(today);
        setFirstDueDate(nextMonth.toISOString().split('T')[0]);
        const configuredSalaryDay = listData?.salaryDay;
        setFirstDueMonth(isValidSalaryDay(configuredSalaryDay) ? defaultFirstDueMonth(today, configuredSalaryDay) : 'NEXT_MONTH');
        setPaymentMode('BANK_TRANSFER');
        setReference('');
        setDisburseRemarks('');
    };

    // Submit Disbursement
    const handleConfirmDisburse = async () => {
        if (!disbursingLoan) return;
        if (referenceMissing) {
            toast({ title: 'Reference Required', description: 'Enter the payment reference / UTR number for a bank transfer.', variant: 'destructive' });
            return;
        }
        setDisburseSubmitting(true);
        try {
            const res = await apiClient.post('/hr/staff-loans/disburse', {
                id: disbursingLoan.id,
                expectedVersion: disbursingLoan.version,
                disbursementDate: disburseDate,
                paymentMode,
                reference: reference.trim() || null,
                // With a salary date the server builds every due date from it; otherwise the entered date is used.
                ...(salaryDay !== null ? { firstDueMonth: effectiveFirstDueMonth } : { firstDueDate }),
                remarks: disburseRemarks.trim() || null,
            });
            if (!res.success) throw new Error(res.error || 'Disbursement failed');
            toast({
                title: 'Loan Disbursed',
                description: `Loan ${disbursingLoan.loanNumber} has been activated and installment schedules generated.`,
            });
            setDisbursingLoan(null);
            void loadList(activeTab, page);
        } catch (err) {
            toast({
                title: 'Disbursement Failed',
                description: err instanceof Error ? err.message : 'Unable to disburse loan.',
                variant: 'destructive',
            });
        } finally {
            setDisburseSubmitting(false);
        }
    };

    const getStatusBadge = (status: string, currentStage: string | null) => {
        switch (status) {
            case 'DRAFT':
                return <Badge variant="secondary">Draft</Badge>;
            case 'SUBMITTED':
                return (
                    <div className="flex flex-col gap-0.5 items-start">
                        <Badge className="bg-blue-600 hover:bg-blue-700 text-white">Under Review</Badge>
                        {currentStage && <span className="text-[11px] text-muted-foreground">{currentStage}</span>}
                    </div>
                );
            case 'RETURNED':
                return <Badge className="bg-amber-500 hover:bg-amber-600 text-white">Returned</Badge>;
            case 'APPROVED':
                return <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white">Approved</Badge>;
            case 'REJECTED':
                return <Badge variant="destructive">Rejected</Badge>;
            case 'CANCELLED':
                return <Badge variant="outline" className="text-muted-foreground">Cancelled</Badge>;
            default:
                return <Badge variant="outline">{status}</Badge>;
        }
    };

    if (capsLoading) {
        return (
            <div className="p-8">
                <PageLoader label="Checking staff loan management permissions..." />
            </div>
        );
    }

    const hasAnyAccess = capabilities && (capabilities.register || capabilities.approvals || capabilities.disbursements);

    if (!hasAnyAccess) {
        return (
            <div className="max-w-4xl mx-auto p-8 text-center space-y-4">
                <ShieldCheck className="h-12 w-12 mx-auto text-muted-foreground/40" />
                <h2 className="text-xl font-semibold">Staff Loan Management</h2>
                <p className="text-sm text-muted-foreground">
                    You do not currently hold an assigned role or permission for Staff Loan Management.
                    If you are an approver or disbursement officer, please ensure your role assignment is active and verified by the administrator.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6 p-4 md:p-8 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-card border rounded-xl p-6 shadow-sm">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                        <h1 className="text-2xl font-bold tracking-tight">Loan Management</h1>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Review staff loan applications, manage stage approvals, and process loan disbursements.
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { void loadCapabilities(); void loadList(activeTab, page); }}
                    className="gap-2"
                >
                    <RefreshCw className="h-4 w-4" /> Refresh
                </Button>
            </div>

            {/* Workflow Navigation Tabs */}
            <Tabs
                value={activeTab}
                onValueChange={val => setActiveTab(val as TabKey)}
                className="space-y-4"
            >
                <TabsList className="grid grid-cols-3 max-w-md">
                    <TabsTrigger value="register" className="gap-2">
                        <BookOpen className="h-4 w-4" />
                        <span>Loan Register</span>
                    </TabsTrigger>
                    <TabsTrigger value="approvals" className="gap-2">
                        <CheckSquare className="h-4 w-4" />
                        <span>Approvals</span>
                    </TabsTrigger>
                    <TabsTrigger value="disbursements" className="gap-2">
                        <Banknote className="h-4 w-4" />
                        <span>Disbursements</span>
                    </TabsTrigger>
                </TabsList>

                {/* Tab Content Cards */}
                <Card className="border shadow-sm">
                    <CardHeader className="pb-3">
                        <div className="flex justify-between items-center">
                            <div>
                                <CardTitle className="text-lg">
                                    {activeTab === 'register' && 'Staff Loan Register'}
                                    {activeTab === 'approvals' && 'Pending Loan Approvals'}
                                    {activeTab === 'disbursements' && 'Approved Loans Awaiting Disbursement'}
                                </CardTitle>
                            </div>
                            {listData && capabilities?.[activeTab] && (
                                <Badge variant="outline" className="text-xs">
                                    Total: {listData.total}
                                </Badge>
                            )}
                        </div>
                    </CardHeader>

                    <CardContent className="p-0">
                        {capabilities && !capabilities[activeTab] ? (
                            <div className="p-12 text-center max-w-md mx-auto space-y-3">
                                <ShieldCheck className="h-10 w-10 mx-auto text-muted-foreground/40" />
                                <div className="text-base font-semibold">
                                    {activeTab === 'approvals' && 'No Approval Authority'}
                                    {activeTab === 'disbursements' && 'No Disbursement Authority'}
                                    {activeTab === 'register' && 'Access Restricted'}
                                </div>
                                <p className="text-sm text-muted-foreground">
                                    {activeTab === 'approvals' && 'Your assigned role does not hold review permissions for pending approval stages, or an approval workflow is not yet published in Masters.'}
                                    {activeTab === 'disbursements' && 'Your assigned role is not designated as an authorized disburser in the active workflow configuration.'}
                                    {activeTab === 'register' && 'You do not hold view permissions for the staff loan register.'}
                                </p>
                            </div>
                        ) : listLoading ? (
                            <div className="p-12 text-center">
                                <PageLoader label="Loading loan records..." fullScreen={false} />
                            </div>
                        ) : listData?.items.length === 0 ? (
                            <div className="text-center py-16 text-sm text-muted-foreground space-y-2">
                                <FileText className="h-8 w-8 mx-auto text-muted-foreground/40" />
                                <div>No loans found in this queue.</div>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-muted/40">
                                            <TableHead>Loan No.</TableHead>
                                            <TableHead>Employee</TableHead>
                                            <TableHead>Branch</TableHead>
                                            <TableHead>Scheme</TableHead>
                                            <TableHead className="text-right">Loan Amount</TableHead>
                                            <TableHead className="text-right">Interest</TableHead>
                                            <TableHead className="text-right">Total Payable</TableHead>
                                            <TableHead className="text-center">Tenure</TableHead>
                                            <TableHead className="text-center">Total Loans</TableHead>
                                            <TableHead className="text-center">Completed</TableHead>
                                            <TableHead>Recovery</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Date</TableHead>
                                            <TableHead className="text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {listData?.items.map(row => (
                                            <TableRow key={row.id} className="hover:bg-muted/30">
                                                <TableCell className="font-mono text-xs font-medium">{row.loanNumber}</TableCell>
                                                <TableCell>
                                                    <div className="font-medium text-foreground">{row.employeeName}</div>
                                                    {row.employeeCode && <div className="text-xs text-muted-foreground">{row.employeeCode}</div>}
                                                </TableCell>
                                                <TableCell className="text-xs">{row.branchName}</TableCell>
                                                <TableCell className="text-xs font-medium">{row.schemeName}</TableCell>
                                                <TableCell className="text-right font-semibold">{formatCurrency(row.approvedAmount ?? row.requestedAmount)}</TableCell>
                                                <TableCell className="text-right text-xs">
                                                    <div className="font-medium">{formatCurrency(row.interestAmount)}</div>
                                                    <div className="text-[11px] text-muted-foreground">{interestRateLabel(row)}</div>
                                                </TableCell>
                                                <TableCell className="text-right text-xs font-semibold">{formatCurrency(row.totalPayable)}</TableCell>
                                                <TableCell className="text-center text-xs">{row.tenureMonths} mo</TableCell>
                                                <TableCell className="text-center text-xs">{row.totalLoans ?? 0}</TableCell>
                                                <TableCell className="text-center text-xs">{row.completedLoans ?? 0}</TableCell>
                                                <TableCell className="text-xs">{row.recoveryMethod === 'SALARY' ? 'Salary' : 'Cash/Bank'}</TableCell>
                                                <TableCell>{getStatusBadge(row.status, row.currentStage)}</TableCell>
                                                <TableCell className="text-xs text-muted-foreground">{formatDate(row.createdAt)}</TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-8 w-8 p-0"
                                                            title="View Details"
                                                            onClick={() => void handleViewDetail(row.id)}
                                                        >
                                                            <Eye className="h-4 w-4" />
                                                        </Button>
                                                        {activeTab === 'approvals' && row.canReview && (
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-8 px-2 text-xs font-medium text-emerald-600 dark:text-emerald-400 gap-1"
                                                                title="Review Application"
                                                                onClick={() => openReview(row)}
                                                            >
                                                                <CheckSquare className="h-4 w-4" />
                                                                <span>Review</span>
                                                            </Button>
                                                        )}
                                                        {activeTab === 'disbursements' && row.status === 'APPROVED' && (
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-8 px-2 text-xs font-medium text-blue-600 dark:text-blue-400 gap-1"
                                                                title="Disburse Loan"
                                                                onClick={() => openDisburse(row)}
                                                            >
                                                                <Banknote className="h-4 w-4" />
                                                                <span>Disburse</span>
                                                            </Button>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </Tabs>

            {/* Application Detail Dialog */}
            <Dialog open={!!viewId} onOpenChange={open => { if (!open) closeDetail(); }}>
                <DialogContent className="sm:max-w-[min(1200px,95vw)] max-h-[92vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center justify-between pr-6">
                            <span>Loan Details — {detailData?.loanNumber}</span>
                            {detailData && getStatusBadge(detailData.status, detailData.currentStage)}
                        </DialogTitle>
                        <DialogDescription>
                            Loan terms, employee details, loan history, repayment track and decision timeline.
                        </DialogDescription>
                    </DialogHeader>

                    {detailLoading || !detailData ? (
                        <div className="py-8">
                            <PageLoader label="Loading loan details..." fullScreen={false} />
                        </div>
                    ) : (
                        <div className="space-y-6 pt-2">
                            {/* Current loan */}
                            <div className="space-y-3">
                                <SectionTitle>Current Loan Details</SectionTitle>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-muted/40 p-4 rounded-lg">
                                    <Field label="Loan Number"><span className="font-mono">{detailData.loanNumber}</span></Field>
                                    <Field label="Loan Amount">{formatCurrency(detailData.approvedAmount ?? detailData.requestedAmount)}</Field>
                                    <Field label="Interest Amount">
                                        {formatCurrency(detailData.interestAmount)}
                                        <div className="text-[11px] font-normal text-muted-foreground">{interestRateLabel(detailData)}</div>
                                    </Field>
                                    <Field label="Total Payable">{formatCurrency(detailData.totalPayable)}</Field>
                                    <Field label="Tenure">{detailData.tenureMonths} Months</Field>
                                    <Field label="Monthly EMI / Repayment">{formatCurrency(detailData.monthlyInstallment)}</Field>
                                    <Field label="Application Date">{formatDate(detailData.createdAt)}</Field>
                                    <Field label="Approval Status">{getStatusBadge(detailData.status, detailData.currentStage)}</Field>
                                    <Field label="Disbursement Status">{detailData.disbursementStatus}</Field>
                                    <Field label="Paid Amount">{detailData.repayment ? formatCurrency(detailData.repayment.paidAmount) : '—'}</Field>
                                    <Field label="Outstanding Amount">{detailData.repayment ? formatCurrency(detailData.repayment.outstandingAmount) : '—'}</Field>
                                    <Field label="Remaining Amount (Principal)">{detailData.repayment ? formatCurrency(detailData.repayment.remainingPrincipal) : '—'}</Field>
                                </div>
                                <div className="space-y-2 text-xs">
                                    <div>
                                        <span className="font-semibold text-foreground">Loan Purpose: </span>
                                        <span className="text-muted-foreground">{detailData.purpose}</span>
                                    </div>
                                    {detailData.remarks && (
                                        <div>
                                            <span className="font-semibold text-foreground">Applicant Remarks: </span>
                                            <span className="text-muted-foreground">{detailData.remarks}</span>
                                        </div>
                                    )}
                                    <div>
                                        <span className="font-semibold text-foreground">Supporting Document: </span>
                                        {detailData.document ? (
                                            <button type="button" className="text-primary hover:underline" onClick={() => void handleViewDocument(detailData.id)}>
                                                {detailData.document.fileName}
                                            </button>
                                        ) : (
                                            <span className="text-muted-foreground">Not attached</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <EmployeePanel employee={detailData.employee} />

                            <PastLoansTable loans={detailData.pastLoans} />

                            {/* Repayment track */}
                            <div className="space-y-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-2"
                                    disabled={!detailData.repayment}
                                    onClick={() => setShowTrack(value => !value)}
                                >
                                    <ListOrdered className="h-4 w-4" />
                                    {showTrack ? 'Hide Repayment Track' : 'Show Repayment Track'}
                                </Button>
                                {!detailData.repayment && (
                                    <p className="text-xs text-muted-foreground">The repayment schedule is created when the loan is disbursed.</p>
                                )}
                                {showTrack && detailData.repayment && <RepaymentTrackTable schedules={detailData.repayment.schedules} />}
                            </div>

                            {/* Workflow Stages Progression */}
                            {detailData.stages.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Workflow Stages</h4>
                                    <div className="flex flex-wrap gap-2">
                                        {detailData.stages.map(stage => {
                                            const isCurrent = detailData.status === 'SUBMITTED' && detailData.currentStage === stage.stageName;
                                            return (
                                                <div
                                                    key={stage.levelOrder}
                                                    className={`px-3 py-1.5 rounded-md text-xs border flex items-center gap-1.5 ${isCurrent ? 'bg-blue-50 border-blue-300 dark:bg-blue-950/50 dark:border-blue-800 text-blue-700 dark:text-blue-300 font-semibold' : 'bg-muted/40 text-muted-foreground'}`}
                                                >
                                                    <span className="w-4 h-4 rounded-full bg-muted flex items-center justify-center text-[10px]">
                                                        {stage.levelOrder}
                                                    </span>
                                                    <span>{stage.stageName}</span>
                                                    <span className="text-[10px] text-muted-foreground">({stage.roleName})</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Decision History Audit Trail */}
                            <div className="space-y-2">
                                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Decision Audit Trail</h4>
                                {detailData.decisions.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">No decisions recorded yet.</p>
                                ) : (
                                    <div className="border rounded-md overflow-hidden text-xs">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="bg-muted/40">
                                                    <TableHead>Time</TableHead>
                                                    <TableHead>Action</TableHead>
                                                    <TableHead>Stage</TableHead>
                                                    <TableHead>Reviewer</TableHead>
                                                    <TableHead>Remarks</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {detailData.decisions.map(d => (
                                                    <TableRow key={d.id}>
                                                        <TableCell className="text-muted-foreground">{formatDate(d.createdAt)}</TableCell>
                                                        <TableCell>
                                                            <Badge variant={d.action === 'APPROVE' ? 'default' : d.action === 'REJECT' ? 'destructive' : 'secondary'}>
                                                                {d.action === 'EDIT' ? 'EDITED' : d.action}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell>{d.stageName || '—'}</TableCell>
                                                        <TableCell className="font-medium">{d.actorName}</TableCell>
                                                        <TableCell className="text-muted-foreground">{d.remarks || '—'}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'approvals' && detailData?.canReview && (
                        <DialogFooter>
                            <Button
                                size="sm"
                                className="gap-2"
                                onClick={() => { const loan = detailData; closeDetail(); openReview(loan); }}
                            >
                                <Pencil className="h-4 w-4" /> Edit / Review
                            </Button>
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>

            {/* Review Modal Dialog */}
            <Dialog open={!!reviewingLoan} onOpenChange={open => { if (!open && !reviewSubmitting && !editSaving) closeReview(); }}>
                <DialogContent className="sm:max-w-[min(1100px,95vw)] max-h-[92vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Review Staff Loan Application</DialogTitle>
                        <DialogDescription>
                            {reviewingLoan?.loanNumber} — {reviewingLoan?.employeeName} ({reviewingLoan?.branchName})
                        </DialogDescription>
                    </DialogHeader>

                    {reviewLoading || !reviewDetail ? (
                        <div className="py-8">
                            <PageLoader label="Loading application..." fullScreen={false} />
                        </div>
                    ) : (
                        <div className="space-y-5 py-2">
                            <EmployeePanel employee={reviewDetail.employee} />

                            {/* Loan terms (editable by the approver) */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <SectionTitle>Loan Terms</SectionTitle>
                                    {!editingTerms && (
                                        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={startEditTerms}>
                                            <Pencil className="h-3.5 w-3.5" /> Edit
                                        </Button>
                                    )}
                                </div>

                                {!editingTerms ? (
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-muted/40 p-4 rounded-lg">
                                        <Field label="Loan Amount">{formatCurrency(reviewDetail.requestedAmount)}</Field>
                                        <Field label="Interest Amount">
                                            {formatCurrency(reviewDetail.interestAmount)}
                                            <div className="text-[11px] font-normal text-muted-foreground">{interestRateLabel(reviewDetail)}</div>
                                        </Field>
                                        <Field label="Total Payable">{formatCurrency(reviewDetail.totalPayable)}</Field>
                                        <Field label="Tenure">{reviewDetail.tenureMonths} Months</Field>
                                        <Field label="Monthly EMI / Repayment">{formatCurrency(reviewDetail.monthlyInstallment)}</Field>
                                        <Field label="Scheme">{reviewDetail.schemeName}</Field>
                                        <Field label="Recovery Mode">{reviewDetail.recoveryMethod === 'SALARY' ? 'Salary Deduction' : 'Cash / Bank'}</Field>
                                        <Field label="Current Stage">{reviewDetail.currentStage ?? '—'}</Field>
                                        <Field label="Supporting Document">
                                            {reviewDetail.document ? (
                                                <button type="button" className="text-primary hover:underline" onClick={() => void handleViewDocument(reviewDetail.id)}>
                                                    {reviewDetail.document.fileName}
                                                </button>
                                            ) : 'Not attached'}
                                        </Field>
                                        <div className="col-span-2 sm:col-span-4">
                                            <Field label="Loan Purpose">{reviewDetail.purpose}</Field>
                                        </div>
                                        {reviewDetail.remarks && (
                                            <div className="col-span-2 sm:col-span-4">
                                                <Field label="Applicant Remarks">{reviewDetail.remarks}</Field>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-4 rounded-lg border border-primary/40 p-4 text-xs">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div className="space-y-1.5">
                                                <Label className="text-xs">Loan Scheme <span className="text-destructive">*</span></Label>
                                                <Select value={editSchemeId} onValueChange={handleEditSchemeChange}>
                                                    <SelectTrigger className="text-xs"><SelectValue placeholder="Select scheme" /></SelectTrigger>
                                                    <SelectContent>
                                                        {editSchemes.map(option => (
                                                            <SelectItem key={option.id} value={option.id}>
                                                                {option.name} ({option.code}){option.eligibilityError && option.id !== reviewDetail.schemeId ? ' — Ineligible' : ''}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                {editScheme && (
                                                    <p className="text-[11px] text-muted-foreground">
                                                        Max {editScheme.maximumAmount != null ? formatCurrency(editScheme.maximumAmount) : 'per salary'} · up to {editScheme.maximumTenureMonths} months
                                                    </p>
                                                )}
                                                {editScheme?.eligibilityError && editSchemeId !== reviewDetail.schemeId && (
                                                    <p className="text-[11px] text-destructive">{editScheme.eligibilityError}</p>
                                                )}
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-xs">Recovery Mode <span className="text-destructive">*</span></Label>
                                                <Select value={editRecovery} onValueChange={val => setEditRecovery(val as 'SALARY' | 'CASH_BANK')}>
                                                    <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="SALARY">Salary Deduction</SelectItem>
                                                        {reviewDetail.recoveryMethod === 'CASH_BANK' && <SelectItem value="CASH_BANK">Cash / Bank Repayment</SelectItem>}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                                            <div className="space-y-1.5">
                                                <Label htmlFor="edit-amount" className="text-xs">Loan Amount (₹) <span className="text-destructive">*</span></Label>
                                                <Input id="edit-amount" type="number" min="0" step="0.01" value={editAmount} onChange={e => setEditAmount(e.target.value)} className="text-xs" />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label htmlFor="edit-tenure" className="text-xs">Tenure (months) <span className="text-destructive">*</span></Label>
                                                <Input id="edit-tenure" type="number" min="1" step="1" value={editTenure} onChange={e => setEditTenure(e.target.value)} className="text-xs" />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-xs">Interest Type <span className="text-destructive">*</span></Label>
                                                <Select value={editInterestType} onValueChange={val => handleEditInterestTypeChange(val as 'INTEREST_FREE' | 'FLAT' | 'MONTHLY')}>
                                                    <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="INTEREST_FREE">Interest-free</SelectItem>
                                                        <SelectItem value="FLAT">Flat (annual %)</SelectItem>
                                                        <SelectItem value="MONTHLY">Monthly %</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label htmlFor="edit-rate" className="text-xs">
                                                    Interest Rate (%){editInterestType === 'MONTHLY' ? ' per month' : editInterestType === 'FLAT' ? ' per year' : ''}
                                                </Label>
                                                <Input
                                                    id="edit-rate"
                                                    type="number"
                                                    min="0"
                                                    step="0.0001"
                                                    value={editInterestType === 'INTEREST_FREE' ? '0' : editRate}
                                                    disabled={editInterestType === 'INTEREST_FREE'}
                                                    onChange={e => setEditRate(e.target.value)}
                                                    className="text-xs"
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-1.5">
                                            <Label htmlFor="edit-purpose" className="text-xs">Loan Purpose <span className="text-destructive">*</span></Label>
                                            <Textarea id="edit-purpose" rows={2} value={editPurpose} onChange={e => setEditPurpose(e.target.value)} className="text-xs" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="edit-remarks" className="text-xs">Applicant Remarks</Label>
                                            <Textarea id="edit-remarks" rows={2} value={editRemarks} onChange={e => setEditRemarks(e.target.value)} className="text-xs" />
                                        </div>

                                        <div className="space-y-1.5">
                                            <Label className="text-xs">Supporting Document</Label>
                                            <input ref={editDocumentInput} type="file" accept={STAFF_LOAN_DOCUMENT_ACCEPT} className="hidden" onChange={handleEditDocumentPicked} />
                                            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                                                <FileText className="h-4 w-4 shrink-0 text-primary" />
                                                {editDocument ? (
                                                    <span className="font-medium">{editDocument.fileName} <span className="font-normal text-muted-foreground">({formatBytes(editDocument.fileSize)}, replaces the current file)</span></span>
                                                ) : reviewDetail.document ? (
                                                    <button type="button" className="font-medium text-primary hover:underline" onClick={() => void handleViewDocument(reviewDetail.id)}>{reviewDetail.document.fileName}</button>
                                                ) : (
                                                    <span className="text-muted-foreground">No document attached</span>
                                                )}
                                                <div className="ml-auto flex gap-2">
                                                    {editDocument && (
                                                        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" disabled={editUploading || editSaving} onClick={() => setEditDocument(null)}>Undo</Button>
                                                    )}
                                                    <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs" disabled={editUploading || editSaving} onClick={() => editDocumentInput.current?.click()}>
                                                        {editUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                                                        {editUploading ? 'Uploading...' : 'Replace'}
                                                    </Button>
                                                </div>
                                            </div>
                                            <p className="text-[11px] text-muted-foreground">JPG, PNG or PDF up to 5 MB. Images are compressed automatically.</p>
                                        </div>

                                        <div className="space-y-1.5">
                                            <Label htmlFor="edit-reason" className="text-xs">Reason for edit (optional, saved in the audit trail)</Label>
                                            <Input id="edit-reason" value={editReason} onChange={e => setEditReason(e.target.value)} className="text-xs" />
                                        </div>
                                        <div className="grid grid-cols-3 gap-3 rounded-md bg-muted/50 p-3">
                                            <Field label="Interest Amount">{editPreview ? formatCurrency(editPreview.totalInterest) : '—'}</Field>
                                            <Field label="Total Payable">{editPreview ? formatCurrency(editPreview.totalRepayment) : '—'}</Field>
                                            <Field label="Monthly EMI">{editPreview ? formatCurrency(editPreview.installments[0]?.total) : '—'}</Field>
                                        </div>
                                        {editError && <p className="text-destructive">{editError}</p>}
                                        <div className="flex justify-end gap-2">
                                            <Button variant="outline" size="sm" disabled={editSaving || editUploading} onClick={() => setEditingTerms(false)}>Cancel Edit</Button>
                                            <Button size="sm" disabled={editSaving || editUploading} onClick={() => void handleSaveTerms()}>
                                                {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Changes'}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <PastLoansTable loans={reviewDetail.pastLoans} />

                            {/* Decision Selection */}
                            <div className="space-y-2">
                                <Label className="text-xs font-semibold">Select Decision</Label>
                                <RadioGroup
                                    value={reviewAction}
                                    onValueChange={val => setReviewAction(val as 'APPROVE' | 'REJECT')}
                                    className="grid grid-cols-2 gap-2 max-w-md"
                                >
                                    <div>
                                        <RadioGroupItem value="APPROVE" id="act-approve" className="peer sr-only" />
                                        <Label
                                            htmlFor="act-approve"
                                            className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-2.5 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-emerald-600 [&:has([data-state=checked])]:border-emerald-600 cursor-pointer text-xs"
                                        >
                                            <CheckCircle2 className="mb-1 h-4 w-4 text-emerald-600" />
                                            Approve
                                        </Label>
                                    </div>
                                    <div>
                                        <RadioGroupItem value="REJECT" id="act-reject" className="peer sr-only" />
                                        <Label
                                            htmlFor="act-reject"
                                            className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-2.5 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-destructive [&:has([data-state=checked])]:border-destructive cursor-pointer text-xs"
                                        >
                                            <XCircle className="mb-1 h-4 w-4 text-destructive" />
                                            Reject
                                        </Label>
                                    </div>
                                </RadioGroup>
                            </div>

                            {/* Remarks */}
                            <div className="space-y-1.5">
                                <Label htmlFor="review-remarks" className="text-xs">
                                    Review Remarks {reviewAction === 'REJECT' && <span className="text-destructive">*</span>}
                                </Label>
                                <Textarea
                                    id="review-remarks"
                                    placeholder={reviewAction === 'REJECT' ? 'Provide reason for rejection...' : 'Optional approval notes...'}
                                    rows={3}
                                    value={reviewRemarks}
                                    onChange={e => setReviewRemarks(e.target.value)}
                                    className="text-xs"
                                />
                            </div>
                        </div>
                    )}

                    <DialogFooter className="gap-2 sm:items-center">
                        {editingTerms && <span className="text-xs text-muted-foreground sm:mr-auto">Save or cancel your edit before deciding.</span>}
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={reviewSubmitting || editSaving}
                            onClick={closeReview}
                        >
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            className={reviewAction === 'REJECT' ? 'bg-destructive hover:bg-destructive/90 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}
                            disabled={reviewSubmitting || editSaving || editingTerms || reviewLoading || !reviewDetail}
                            onClick={() => void handleSubmitReview()}
                        >
                            {reviewSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm Decision'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Disburse Modal Dialog */}
            <Dialog open={!!disbursingLoan} onOpenChange={open => { if (!open) setDisbursingLoan(null); }}>
                <DialogContent className="sm:max-w-[min(680px,95vw)] max-h-[92vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Disburse Staff Loan</DialogTitle>
                        <DialogDescription>
                            {disbursingLoan?.loanNumber} — {disbursingLoan?.employeeName}
                        </DialogDescription>
                    </DialogHeader>

                    {disbursingLoan && (
                        <div className="space-y-4 py-2">
                            {/* Terms Overview */}
                            <div className="p-3 bg-muted/50 rounded-lg text-xs grid grid-cols-2 gap-2">
                                <div>
                                    <span className="text-muted-foreground">Approved Amount: </span>
                                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(disbursingLoan.approvedAmount ?? disbursingLoan.requestedAmount)}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">Tenure: </span>
                                    <span className="font-semibold text-foreground">{disbursingLoan.tenureMonths} Months</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">Scheme: </span>
                                    <span className="font-medium text-foreground">{disbursingLoan.schemeName}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">Interest: </span>
                                    <span className="font-medium text-foreground">{formatCurrency(disbursingLoan.interestAmount)} ({interestRateLabel(disbursingLoan)})</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">Total Payable: </span>
                                    <span className="font-semibold text-foreground">{formatCurrency(disbursingLoan.totalPayable)}</span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                {/* Disbursement Date */}
                                <div className="space-y-1.5">
                                    <Label htmlFor="disb-date" className="text-xs">Disbursement Date</Label>
                                    <DateInput
                                        id="disb-date"
                                        value={disburseDate}
                                        onChange={e => setDisburseDate(e.target.value)}
                                        className="text-xs"
                                    />
                                </div>

                                {/* Payment Mode */}
                                <div className="space-y-1.5">
                                    <Label htmlFor="disb-mode" className="text-xs">Payment Mode</Label>
                                    <Select value={paymentMode} onValueChange={val => setPaymentMode(val as 'CASH' | 'BANK_TRANSFER')}>
                                        <SelectTrigger id="disb-mode" className="text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                                            <SelectItem value="CASH">Cash Payment</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                {/* Reference */}
                                <div className="space-y-1.5">
                                    <Label htmlFor="disb-ref" className="text-xs">
                                        Payment Reference / UTR{referenceRequired && <span className="text-destructive"> *</span>}
                                    </Label>
                                    <Input
                                        id="disb-ref"
                                        placeholder="e.g. UTR12345678"
                                        value={reference}
                                        onChange={e => setReference(e.target.value)}
                                        required={referenceRequired}
                                        aria-invalid={referenceMissing}
                                        className={`text-xs ${referenceMissing ? 'border-destructive' : ''}`}
                                    />
                                    {referenceMissing && (
                                        <p className="text-[11px] text-destructive">Required for a bank transfer.</p>
                                    )}
                                </div>

                                {/* First Due Date */}
                                {salaryDay !== null ? (
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">First Due Date Month</Label>
                                        <RadioGroup
                                            value={effectiveFirstDueMonth}
                                            onValueChange={val => setFirstDueMonth(val as FirstDueMonth)}
                                            className="grid grid-cols-2 gap-2"
                                        >
                                            <div>
                                                <RadioGroupItem value="THIS_MONTH" id="due-this-month" className="peer sr-only" disabled={!thisMonthAvailable} />
                                                <Label
                                                    htmlFor="due-this-month"
                                                    className={`flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-xs peer-data-[state=checked]:border-emerald-600 ${thisMonthAvailable ? 'cursor-pointer hover:bg-accent' : 'cursor-not-allowed opacity-50'}`}
                                                >
                                                    This month
                                                </Label>
                                            </div>
                                            <div>
                                                <RadioGroupItem value="NEXT_MONTH" id="due-next-month" className="peer sr-only" />
                                                <Label
                                                    htmlFor="due-next-month"
                                                    className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-xs cursor-pointer hover:bg-accent peer-data-[state=checked]:border-emerald-600"
                                                >
                                                    Next month
                                                </Label>
                                            </div>
                                        </RadioGroup>
                                        {!thisMonthAvailable && (
                                            <p className="text-[11px] text-muted-foreground">This month's salary date has already passed for this disbursement date.</p>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-1.5">
                                        <Label htmlFor="disb-due" className="text-xs">First Due Date</Label>
                                        <DateInput
                                            id="disb-due"
                                            value={firstDueDate}
                                            onChange={e => setFirstDueDate(e.target.value)}
                                            className="text-xs"
                                        />
                                    </div>
                                )}
                            </div>

                            {salaryDay !== null ? (
                                <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-xs">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                        <span>
                                            <span className="text-muted-foreground">Salary date: </span>
                                            <span className="font-semibold text-foreground">{salaryDay}{salaryDay === 31 ? ' (last day in shorter months)' : ''} of every month</span>
                                        </span>
                                        <span>
                                            <span className="text-muted-foreground">First due date: </span>
                                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">{dueDatePreview[0] ? formatDueDate(dueDatePreview[0]) : '—'}</span>
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">If a due date falls on a Sunday it moves to the previous day (Saturday), for every installment.</p>
                                    {dueDatePreview.length > 0 && (
                                        <div className="max-h-28 space-y-0.5 overflow-y-auto rounded border bg-background p-2">
                                            {dueDatePreview.map((due, index) => (
                                                <div key={`${due}-${index}`} className="flex justify-between text-[11px]">
                                                    <span className="text-muted-foreground">Installment {index + 1}</span>
                                                    <span className="font-medium text-foreground">{formatDueDate(due)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <p className="rounded-md border border-amber-300/60 bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                                    No salary date is set yet. Set one under Masters &gt; Staff Loan Approval Workflow so due dates follow it automatically. For now the first due date is entered manually and later installments fall one month apart.
                                </p>
                            )}

                            {/* Remarks */}
                            <div className="space-y-1.5">
                                <Label htmlFor="disb-remarks" className="text-xs">Disbursement Remarks</Label>
                                <Input
                                    id="disb-remarks"
                                    placeholder="Optional notes..."
                                    value={disburseRemarks}
                                    onChange={e => setDisburseRemarks(e.target.value)}
                                    className="text-xs"
                                />
                            </div>
                        </div>
                    )}

                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={disburseSubmitting}
                            onClick={() => setDisbursingLoan(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            disabled={disburseSubmitting || !disburseDate || referenceMissing || (salaryDay === null && !firstDueDate)}
                            onClick={() => void handleConfirmDisburse()}
                        >
                            {disburseSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm Disbursement'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
