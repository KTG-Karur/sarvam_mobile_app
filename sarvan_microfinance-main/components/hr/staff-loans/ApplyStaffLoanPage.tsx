'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertCircle,
    Building2,
    Calendar,
    CheckCircle2,
    Clock,
    CreditCard,
    Eye,
    FileEdit,
    FileText,
    HandCoins,
    HelpCircle,
    IndianRupee,
    Info,
    Loader2,
    RefreshCw,
    Send,
    Upload,
    User,
    X,
    XCircle,
} from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import {
    previewInstallments,
    type ApplicationDetail,
    type ApplicationList,
    type ApplicationOption,
    type ApplicationOptions,
    type ApplicationRow,
} from '@/app/lib/staff-loans/application';
import { compressImageForCategory, formatBytes } from '@/app/lib/image-compress';
import { STAFF_LOAN_DOCUMENT_ACCEPT, STAFF_LOAN_DOCUMENT_MAX_BYTES } from '@/app/lib/staff-loans/document-rule';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageLoader } from '@/components/ui/page-loader';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

const formatCurrency = (val: number | null | undefined) => {
    if (val === null || val === undefined || isNaN(val)) return '₹0.00';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(val);
};

const formatDate = (dateStr: string) => {
    try {
        return toDisplayDateTime(new Date(dateStr));
    } catch {
        return dateStr;
    }
};

const formatDateOnly = (dateStr: string) => {
    try {
        return toDisplayDate(new Date(dateStr));
    } catch {
        return dateStr;
    }
};

export default function ApplyStaffLoanPage() {
    const { toast } = useToast();

    // Options & dynamic state
    const [optionsData, setOptionsData] = useState<ApplicationOptions | null>(null);
    const [optionsLoading, setOptionsLoading] = useState(true);
    const [optionsError, setOptionsError] = useState('');
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');

    // Applications list
    const [applications, setApplications] = useState<ApplicationList | null>(null);
    const [listLoading, setListLoading] = useState(true);
    const [page, setPage] = useState(1);

    // Form state
    const [editingLoan, setEditingLoan] = useState<ApplicationRow | null>(null);
    const [selectedSchemeId, setSelectedSchemeId] = useState('');
    const [requestedAmount, setRequestedAmount] = useState('');
    const [tenureMonths, setTenureMonths] = useState('');
    const [recoveryMethod, setRecoveryMethod] = useState<'SALARY' | 'CASH_BANK'>('SALARY');
    const [purpose, setPurpose] = useState('');
    const [remarks, setRemarks] = useState('');
    const [documentFile, setDocumentFile] = useState<{ fileKey: string; fileName: string; fileSize: number } | null>(null);
    const [uploadingDocument, setUploadingDocument] = useState(false);
    const documentInputRef = useRef<HTMLInputElement>(null);
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [savingDraft, setSavingDraft] = useState(false);

    // Schedule breakdown toggle
    const [showSchedule, setShowSchedule] = useState(false);

    // Detail Modal
    const [viewId, setViewId] = useState<string | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailData, setDetailData] = useState<ApplicationDetail | null>(null);

    // Cancel Dialog
    const [cancellingLoan, setCancellingLoan] = useState<ApplicationRow | null>(null);
    const [cancelSubmitting, setCancelSubmitting] = useState(false);

    // Load dynamic options
    const loadOptions = useCallback(async (targetEmployeeId?: string) => {
        setOptionsLoading(true);
        setOptionsError('');
        try {
            const query = targetEmployeeId ? `?employeeId=${encodeURIComponent(targetEmployeeId)}` : '';
            const res = await apiClient.get<ApplicationOptions>(`/hr/staff-loans/options${query}`);
            if (!res.success || !res.data) throw new Error(res.error || 'Failed to load options');
            setOptionsData(res.data);
            if (res.data.employee?.id) {
                setSelectedEmployeeId(res.data.employee.id);
            }
        } catch (err) {
            setOptionsError(err instanceof Error ? err.message : 'Unable to load loan options');
        } finally {
            setOptionsLoading(false);
        }
    }, []);

    // Handle employee change by Admin/HR
    const handleEmployeeChange = (empId: string) => {
        setSelectedEmployeeId(empId);
        setDocumentFile(null);
        setSelectedSchemeId('');
        setRequestedAmount('');
        setTenureMonths('');
        setFormErrors({});
        void loadOptions(empId);
    };

    // Load own applications list
    const loadApplications = useCallback(async (targetPage = 1) => {
        setListLoading(true);
        try {
            const res = await apiClient.get<ApplicationList>(`/hr/staff-loans?tab=own&page=${targetPage}`);
            if (!res.success || !res.data) throw new Error(res.error || 'Failed to load applications');
            setApplications(res.data);
            setPage(targetPage);
        } catch (err) {
            toast({
                title: 'Error',
                description: err instanceof Error ? err.message : 'Failed to load your applications',
                variant: 'destructive',
            });
        } finally {
            setListLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        void loadOptions();
        void loadApplications(1);
    }, [loadOptions, loadApplications]);

    // Selected scheme object
    const selectedScheme = useMemo<ApplicationOption | undefined>(() => {
        return optionsData?.schemes.find(s => s.id === selectedSchemeId);
    }, [optionsData, selectedSchemeId]);

    // Adjust recovery method default if current is not allowed by scheme
    useEffect(() => {
        if (selectedScheme && selectedScheme.recoveryMethods.length > 0) {
            if (!selectedScheme.recoveryMethods.includes(recoveryMethod)) {
                setRecoveryMethod(selectedScheme.recoveryMethods[0]);
            }
        }
    }, [selectedScheme, recoveryMethod]);

    // Repayment schedule preview calculation
    const preview = useMemo(() => {
        if (!selectedScheme) return null;
        const amountNum = Number(requestedAmount);
        const tenureNum = Number(tenureMonths);
        if (isNaN(amountNum) || amountNum <= 0 || isNaN(tenureNum) || tenureNum <= 0 || !Number.isInteger(tenureNum)) {
            return null;
        }
        try {
            return previewInstallments(amountNum, tenureNum, selectedScheme.interestType, selectedScheme.annualInterestRate);
        } catch {
            return null;
        }
    }, [selectedScheme, requestedAmount, tenureMonths]);

    // Reset form
    const resetForm = () => {
        setEditingLoan(null);
        setSelectedSchemeId('');
        setRequestedAmount('');
        setTenureMonths('');
        setRecoveryMethod('SALARY');
        setPurpose('');
        setRemarks('');
        setDocumentFile(null);
        setFormErrors({});
        setShowSchedule(false);
    };

    // Populate form for editing a draft/returned application
    const startEdit = (loan: ApplicationRow) => {
        setEditingLoan(loan);
        setSelectedEmployeeId(loan.employeeId);
        if (optionsData?.canSelectEmployee && optionsData.employee?.id !== loan.employeeId) {
            void loadOptions(loan.employeeId);
        }
        setSelectedSchemeId(loan.schemeId);
        setRequestedAmount(String(loan.requestedAmount));
        setTenureMonths(String(loan.tenureMonths));
        setRecoveryMethod(loan.recoveryMethod);
        setPurpose(loan.purpose);
        setRemarks(loan.remarks || '');
        setDocumentFile(loan.document ? { fileKey: loan.document.fileKey, fileName: loan.document.fileName, fileSize: loan.document.fileSize } : null);
        setFormErrors({});
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Form client-side validation
    const validateForm = (): boolean => {
        const errors: Record<string, string> = {};
        if (!selectedSchemeId) errors.schemeId = 'Please select a scheme';
        if (selectedScheme?.eligibilityError) errors.schemeId = selectedScheme.eligibilityError;

        const amountNum = Number(requestedAmount);
        if (!requestedAmount || isNaN(amountNum) || amountNum <= 0) {
            errors.requestedAmount = 'Enter a valid positive loan amount';
        } else if (!/^\d+(\.\d{1,2})?$/.test(requestedAmount)) {
            errors.requestedAmount = 'Amount cannot have more than 2 decimal places';
        } else if (selectedScheme?.maximumAmount !== null && selectedScheme?.maximumAmount !== undefined && amountNum > selectedScheme.maximumAmount) {
            errors.requestedAmount = `Amount exceeds scheme maximum limit of ${formatCurrency(selectedScheme.maximumAmount)}`;
        }

        const tenureNum = Number(tenureMonths);
        if (!tenureMonths || isNaN(tenureNum) || tenureNum < 1 || !Number.isInteger(tenureNum)) {
            errors.tenureMonths = 'Enter a valid tenure in full months';
        } else if (selectedScheme && tenureNum > selectedScheme.maximumTenureMonths) {
            errors.tenureMonths = `Tenure exceeds scheme limit of ${selectedScheme.maximumTenureMonths} months`;
        }

        if (!purpose.trim()) errors.purpose = 'Please describe the purpose of the loan';
        if (!documentFile) errors.document = 'Upload the supporting document (image or PDF)';

        setFormErrors(errors);
        const firstError = Object.values(errors)[0];
        if (firstError) toast({ title: 'Validation Error', description: firstError, variant: 'destructive' });
        return Object.keys(errors).length === 0;
    };

    // Upload the supporting document: images are compressed in the browser first, then the server
    // validates the real file type and compresses again before storing.
    const handleDocumentSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const picked = event.target.files?.[0];
        event.target.value = '';
        if (!picked) return;
        const isPdf = picked.type === 'application/pdf';
        const isImage = picked.type === 'image/jpeg' || picked.type === 'image/png';
        if (!isPdf && !isImage) {
            setFormErrors(prev => ({ ...prev, document: 'Only JPG, PNG or PDF files are allowed' }));
            toast({ title: 'Upload Failed', description: 'Only JPG, PNG or PDF files are allowed', variant: 'destructive' });
            return;
        }
        setUploadingDocument(true);
        setFormErrors(prev => ({ ...prev, document: '' }));
        try {
            let toUpload = picked;
            if (isImage) {
                const result = await compressImageForCategory(picked, 'document');
                URL.revokeObjectURL(result.previewUrl);
                toUpload = result.compressedFile;
            }
            if (toUpload.size > STAFF_LOAN_DOCUMENT_MAX_BYTES) {
                throw new Error(`The file is too large (${formatBytes(toUpload.size)}). Maximum size is ${formatBytes(STAFF_LOAN_DOCUMENT_MAX_BYTES)}.`);
            }
            const form = new FormData();
            form.append('file', toUpload);
            if (optionsData?.canSelectEmployee && selectedEmployeeId) form.append('employeeId', selectedEmployeeId);
            const res = await apiClient.post<{ fileKey: string; fileName: string; fileSize: number }>('/hr/staff-loans/documents/upload', form);
            if (!res.success || !res.data) throw new Error(res.error || 'Failed to upload the document');
            setDocumentFile({ fileKey: res.data.fileKey, fileName: res.data.fileName, fileSize: res.data.fileSize });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to upload the document';
            setFormErrors(prev => ({ ...prev, document: message }));
            toast({ title: 'Upload Failed', description: message, variant: 'destructive' });
        } finally {
            setUploadingDocument(false);
        }
    };

    // Open the stored document of a saved application (signed URL, scoped to who may see the loan)
    const handleViewDocument = async (loanId: string) => {
        const res = await apiClient.get<{ url: string }>(`/hr/staff-loans/${loanId}/document`);
        if (res.success && res.data?.url) window.open(res.data.url, '_blank', 'noopener,noreferrer');
        else toast({ title: 'Error', description: res.error || 'Could not open the document.', variant: 'destructive' });
    };

    // Handle Save Draft or Submit Application
    const handleSave = async (submit: boolean) => {
        if (!validateForm()) return;
        if (submit && !optionsData?.workflowAvailable) {
            toast({
                title: 'Submission Unavailable',
                description: 'Staff loan approval workflow is not configured yet. You may save your application as a draft for now.',
                variant: 'destructive',
            });
            return;
        }

        if (submit) setSubmitting(true);
        else setSavingDraft(true);

        try {
            const payload = {
                application: {
                    employeeId: optionsData?.canSelectEmployee ? selectedEmployeeId : undefined,
                    schemeId: selectedSchemeId,
                    requestedAmount: Number(requestedAmount),
                    tenureMonths: Number(tenureMonths),
                    recoveryMethod,
                    purpose: purpose.trim(),
                    remarks: remarks.trim(),
                    document: documentFile ? { fileKey: documentFile.fileKey, fileName: documentFile.fileName } : undefined,
                },
                id: editingLoan ? editingLoan.id : null,
                expectedVersion: editingLoan ? editingLoan.version : null,
                submit,
            };

            const res = await apiClient.post('/hr/staff-loans', payload);
            if (!res.success) throw new Error(res.error || 'Failed to save application');

            toast({
                title: submit ? 'Application Submitted' : 'Draft Saved',
                description: submit
                    ? 'Your loan application has been submitted for approval.'
                    : 'Your loan application draft was saved successfully.',
            });

            resetForm();
            void loadOptions(selectedEmployeeId || undefined);
            void loadApplications(1);
        } catch (err) {
            toast({
                title: 'Save Failed',
                description: err instanceof Error ? err.message : 'An error occurred while saving the application.',
                variant: 'destructive',
            });
        } finally {
            setSubmitting(false);
            setSavingDraft(false);
        }
    };

    // View Application Details
    const handleViewDetail = async (id: string) => {
        setViewId(id);
        setDetailLoading(true);
        try {
            const res = await apiClient.get<ApplicationDetail>(`/hr/staff-loans/${id}`);
            if (!res.success || !res.data) throw new Error(res.error || 'Failed to load application details');
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

    // Cancel Application
    const handleConfirmCancel = async () => {
        if (!cancellingLoan) return;
        setCancelSubmitting(true);
        try {
            const res = await apiClient.post('/hr/staff-loans/cancel', {
                id: cancellingLoan.id,
                expectedVersion: cancellingLoan.version,
            });
            if (!res.success) throw new Error(res.error || 'Failed to cancel application');

            toast({
                title: 'Application Cancelled',
                description: `Loan application ${cancellingLoan.loanNumber} has been cancelled.`,
            });
            setCancellingLoan(null);
            void loadOptions();
            void loadApplications(page);
        } catch (err) {
            toast({
                title: 'Cancellation Failed',
                description: err instanceof Error ? err.message : 'Unable to cancel this application.',
                variant: 'destructive',
            });
        } finally {
            setCancelSubmitting(false);
        }
    };

    const getStatusBadge = (status: string, currentStage: string | null) => {
        switch (status) {
            case 'DRAFT':
                return <Badge variant="secondary">Draft</Badge>;
            case 'SUBMITTED':
                return (
                    <div className="flex flex-col gap-1 items-start">
                        <Badge className="bg-blue-600 hover:bg-blue-700 text-white">Under Review</Badge>
                        {currentStage && <span className="text-xs text-muted-foreground">{currentStage}</span>}
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

    if (optionsLoading) {
        return (
            <div className="p-8">
                <PageLoader label="Loading staff loan options and eligibility profile..." />
            </div>
        );
    }

    return (
        <div className="space-y-8 p-4 md:p-8 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card border rounded-xl p-6 shadow-sm">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <HandCoins className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                        <h1 className="text-2xl font-bold tracking-tight">Apply Staff Loan</h1>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Apply for staff loan schemes, preview EMI repayments, and track application status.
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => { void loadOptions(selectedEmployeeId || undefined); void loadApplications(page); }} className="gap-2">
                    <RefreshCw className="h-4 w-4" /> Refresh
                </Button>
            </div>

            {/* Staff Profile & Eligibility Card */}
            {optionsData?.employee && (
                <Card className="border shadow-sm overflow-hidden bg-gradient-to-r from-card via-card to-muted/20">
                    <CardHeader className="p-4 sm:p-5 border-b bg-muted/30">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <div className="h-11 w-11 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold text-sm shrink-0 border border-emerald-200 dark:border-emerald-800/60">
                                    <User className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-bold text-base text-foreground">{optionsData.employee.name}</span>
                                        {optionsData.employee.employeeId && (
                                            <Badge variant="outline" className="font-mono text-xs font-semibold px-2 py-0.5">
                                                {optionsData.employee.employeeId}
                                            </Badge>
                                        )}
                                        {optionsData.employee.designation && (
                                            <Badge variant="secondary" className="text-xs font-medium">
                                                {optionsData.employee.designation.replace(/_/g, ' ')}
                                            </Badge>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {optionsData.canSelectEmployee ? 'Applicant Staff Profile (Selected for Loan Application & Eligibility Calculation)' : 'Applicant Staff Profile (Logged-in Employee)'}
                                    </p>
                                </div>
                            </div>
                            <div>
                                {optionsData.canSelectEmployee ? (
                                    <Badge variant="secondary" className="text-xs bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200">
                                        Administrator Scope
                                    </Badge>
                                ) : (
                                    <Badge variant="outline" className="text-xs text-muted-foreground">
                                        Employee Self Service
                                    </Badge>
                                )}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-4 sm:p-5">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="space-y-1">
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span>Branch / Department</span>
                                </div>
                                <p className="text-sm font-semibold text-foreground">
                                    {optionsData.employee.branchName || 'Unassigned'}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {optionsData.employee.departmentName || 'General'}
                                </p>
                            </div>

                            <div className="space-y-1">
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span>Joining & Service Tenure</span>
                                </div>
                                <p className="text-sm font-semibold text-foreground">
                                    {optionsData.employee.dateOfJoining ? formatDateOnly(optionsData.employee.dateOfJoining) : 'Not Recorded'}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Tenure: <span className="font-semibold text-foreground">{optionsData.employee.serviceFormatted}</span>
                                </p>
                            </div>

                            <div className="space-y-1">
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <IndianRupee className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                    <span>Monthly Gross Salary</span>
                                </div>
                                <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                                    {formatCurrency(optionsData.employee.grossSalary)}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                    {optionsData.employee.grossSalary > 0 ? 'Active Salary Master earnings' : 'No active salary master'}
                                </p>
                            </div>

                            <div className="space-y-1">
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <CreditCard className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                                    <span>Active Staff Loans</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-semibold text-foreground">
                                        {optionsData.employee.activeLoansCount} Running
                                    </p>
                                    <Badge variant={optionsData.employee.activeLoansCount > 0 ? 'secondary' : 'outline'} className="text-[10px] px-1.5 py-0">
                                        {optionsData.employee.activeLoansCount === 0 ? '0 Active' : `${optionsData.employee.activeLoansCount} Active`}
                                    </Badge>
                                </div>
                                <p className="text-[11px] text-muted-foreground">
                                    Subject to scheme active limits
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Workflow Notice if not configured */}
            {!optionsData?.workflowAvailable && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs">
                    <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                    <span><strong>Workflow Inactive:</strong> An active approval workflow must be published before submitting applications. Drafts are allowed.</span>
                </div>
            )}

            {optionsError && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <div>{optionsError}</div>
                </div>
            )}

            <div>
                {/* Application Form */}
                <Card className="border shadow-sm">
                    <CardHeader>
                        <div className="flex justify-between items-center">
                            <div>
                                <CardTitle>{editingLoan ? 'Edit Application' : 'New Loan Request'}</CardTitle>
                                {editingLoan && (
                                    <CardDescription>
                                        Modifying {editingLoan.status.toLowerCase()} application {editingLoan.loanNumber}
                                    </CardDescription>
                                )}
                            </div>
                            {editingLoan && (
                                <Button variant="ghost" size="sm" onClick={resetForm}>
                                    Cancel Edit
                                </Button>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* Row 1: Applicant Employee & Scheme Selection */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Applicant Employee Field */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center h-5">
                                    <Label htmlFor="applicant-employee-field">
                                        Applicant Employee <span className="text-destructive">*</span>
                                    </Label>
                                    {optionsData?.canSelectEmployee ? (
                                        <Badge variant="secondary" className="text-[10px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800">
                                            Admin Mode
                                        </Badge>
                                    ) : (
                                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                            Self Application
                                        </Badge>
                                    )}
                                </div>

                                {optionsData?.canSelectEmployee && optionsData.employees && optionsData.employees.length > 0 ? (
                                    <Select
                                        value={selectedEmployeeId || optionsData.employee?.id}
                                        onValueChange={handleEmployeeChange}
                                        disabled={submitting || savingDraft || !!editingLoan}
                                    >
                                        <SelectTrigger id="applicant-employee-field" className="h-10 text-xs sm:text-sm bg-background">
                                            <SelectValue placeholder="Select an employee..." />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-72">
                                            {optionsData.employees.map(emp => (
                                                <SelectItem key={emp.id} value={emp.id} className="text-xs">
                                                    <span className="font-semibold">{emp.name}</span>
                                                    {emp.employeeId && <span className="text-muted-foreground font-mono ml-1.5">({emp.employeeId})</span>}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <div className="flex items-center justify-between h-10 px-3 rounded-md border bg-muted/30 text-xs">
                                        <div className="flex items-center gap-2 truncate">
                                            <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                            <span className="font-semibold text-foreground truncate">{optionsData?.employee?.name}</span>
                                            {optionsData?.employee?.employeeId && (
                                                <span className="text-muted-foreground font-mono text-[11px]">({optionsData.employee.employeeId})</span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Scheme Selection */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center h-5">
                                    <Label htmlFor="scheme-select">Select Loan Scheme <span className="text-destructive">*</span></Label>
                                </div>
                                {optionsData?.schemes.length === 0 ? (
                                    <div className="h-10 px-3 bg-muted rounded-md text-xs text-muted-foreground flex items-center gap-2">
                                        <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                        <span className="truncate">No active schemes applicable for this profile.</span>
                                    </div>
                                ) : (
                                    <Select
                                        value={selectedSchemeId}
                                        onValueChange={val => {
                                            setSelectedSchemeId(val);
                                            setFormErrors(prev => ({ ...prev, schemeId: '' }));
                                        }}
                                    >
                                        <SelectTrigger id="scheme-select" className="h-10 text-xs sm:text-sm bg-background">
                                            <SelectValue placeholder="Choose a scheme..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {optionsData?.schemes.map(s => (
                                                <SelectItem key={s.id} value={s.id}>
                                                    <span className="font-medium">{s.name}</span> ({s.code})
                                                    {s.eligibilityError ? ' — Ineligible' : ` — Max: ${formatCurrency(s.maximumAmount)}`}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                                {formErrors.schemeId && <p className="text-xs text-destructive">{formErrors.schemeId}</p>}
                            </div>
                        </div>

                        {/* Selected Scheme Information Banner */}
                        {selectedScheme && (
                            <div className={`p-4 rounded-lg border text-sm space-y-2 ${selectedScheme.eligibilityError ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/50' : 'bg-muted/40'}`}>
                                <div className="flex justify-between items-center">
                                    <span className="font-semibold text-foreground">{selectedScheme.name}</span>
                                    <Badge variant={selectedScheme.interestType === 'INTEREST_FREE' ? 'secondary' : 'default'}>
                                        {selectedScheme.interestType === 'INTEREST_FREE' ? '0% Interest-Free'
                                            : selectedScheme.interestType === 'MONTHLY' ? `${selectedScheme.annualInterestRate}% Monthly`
                                            : `${selectedScheme.annualInterestRate}% Flat p.a.`}
                                    </Badge>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-muted-foreground pt-1">
                                    <div>Max Limit: <span className="font-medium text-foreground">{formatCurrency(selectedScheme.maximumAmount)}</span></div>
                                    <div>Max Tenure: <span className="font-medium text-foreground">{selectedScheme.maximumTenureMonths} mo</span></div>
                                    <div>Min Service: <span className="font-medium text-foreground">{selectedScheme.minimumServiceMonths} mo</span></div>
                                    <div>Min Salary: <span className="font-medium text-foreground">{selectedScheme.minimumSalaryPerMonth > 0 ? formatCurrency(selectedScheme.minimumSalaryPerMonth) : 'None'}</span></div>
                                </div>
                                {selectedScheme.eligibilityError && (
                                    <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 pt-1 font-medium">
                                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                        <span>{selectedScheme.eligibilityError}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {/* Requested Amount */}
                            <div className="space-y-2">
                                <Label htmlFor="amount">Requested Amount (₹) <span className="text-destructive">*</span></Label>
                                <Input
                                    id="amount"
                                    type="number"
                                    step="0.01"
                                    placeholder="e.g. 50000"
                                    value={requestedAmount}
                                    onChange={e => {
                                        setRequestedAmount(e.target.value);
                                        setFormErrors(prev => ({ ...prev, requestedAmount: '' }));
                                    }}
                                />
                                {formErrors.requestedAmount && <p className="text-xs text-destructive">{formErrors.requestedAmount}</p>}
                            </div>

                            {/* Tenure in Months */}
                            <div className="space-y-2">
                                <Label htmlFor="tenure">Tenure (Months) <span className="text-destructive">*</span></Label>
                                <Input
                                    id="tenure"
                                    type="number"
                                    step="1"
                                    placeholder={selectedScheme ? `Max ${selectedScheme.maximumTenureMonths}` : 'e.g. 12'}
                                    value={tenureMonths}
                                    onChange={e => {
                                        setTenureMonths(e.target.value);
                                        setFormErrors(prev => ({ ...prev, tenureMonths: '' }));
                                    }}
                                />
                                {formErrors.tenureMonths && <p className="text-xs text-destructive">{formErrors.tenureMonths}</p>}
                            </div>
                        </div>

                        {/* Recovery Method */}
                        <div className="space-y-2">
                            <Label htmlFor="recovery-method">Repayment Recovery Mode</Label>
                            <Select
                                value={recoveryMethod}
                                onValueChange={val => setRecoveryMethod(val as 'SALARY' | 'CASH_BANK')}
                            >
                                <SelectTrigger id="recovery-method">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="SALARY">Salary Deduction</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Supporting Document */}
                        <div className="space-y-2">
                            <Label htmlFor="supporting-document">Supporting Document <span className="text-destructive">*</span></Label>
                            <input
                                id="supporting-document"
                                ref={documentInputRef}
                                type="file"
                                accept={STAFF_LOAN_DOCUMENT_ACCEPT}
                                className="hidden"
                                onChange={handleDocumentSelected}
                            />
                            {documentFile ? (
                                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <FileText className="h-4 w-4 shrink-0 text-primary" />
                                        <span className="truncate font-medium">{documentFile.fileName}</span>
                                        <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(documentFile.fileSize)}</span>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        {editingLoan?.document?.fileKey === documentFile.fileKey && (
                                            <Button type="button" variant="ghost" size="sm" onClick={() => void handleViewDocument(editingLoan.id)}>View</Button>
                                        )}
                                        <Button type="button" variant="outline" size="sm" disabled={uploadingDocument || submitting || savingDraft} onClick={() => documentInputRef.current?.click()}>Replace</Button>
                                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Remove document" disabled={uploadingDocument || submitting || savingDraft} onClick={() => setDocumentFile(null)}>
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <Button type="button" variant="outline" className="w-full justify-center gap-2" disabled={uploadingDocument || submitting || savingDraft} onClick={() => documentInputRef.current?.click()}>
                                    {uploadingDocument ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                                    {uploadingDocument ? 'Uploading...' : 'Upload image or PDF'}
                                </Button>
                            )}
                            <p className="text-xs text-muted-foreground">JPG, PNG or PDF up to 5 MB. Images are compressed automatically.</p>
                            {formErrors.document && <p className="text-xs text-destructive">{formErrors.document}</p>}
                        </div>

                        {/* Purpose */}
                        <div className="space-y-2">
                            <Label htmlFor="purpose">Purpose of Loan <span className="text-destructive">*</span></Label>
                            <Input
                                id="purpose"
                                placeholder="e.g. Medical emergency, home renovation, education"
                                value={purpose}
                                onChange={e => {
                                    setPurpose(e.target.value);
                                    setFormErrors(prev => ({ ...prev, purpose: '' }));
                                }}
                            />
                            {formErrors.purpose && <p className="text-xs text-destructive">{formErrors.purpose}</p>}
                        </div>

                        {/* Remarks */}
                        <div className="space-y-2">
                            <Label htmlFor="remarks">Additional Remarks / Documentation Notes</Label>
                            <Textarea
                                id="remarks"
                                placeholder="Optional notes for the approving manager..."
                                rows={2}
                                value={remarks}
                                onChange={e => setRemarks(e.target.value)}
                            />
                        </div>

                        {/* Live Repayment Preview summary */}
                        {preview && (
                            <div className="rounded-lg border bg-slate-50 dark:bg-slate-900/40 p-4 space-y-3">
                                <div className="flex justify-between items-center">
                                    <span className="text-sm font-semibold flex items-center gap-1.5">
                                        <Clock className="h-4 w-4 text-primary" />
                                        Repayment Estimate ({preview.installmentCount} Installments)
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-xs h-7"
                                        onClick={() => setShowSchedule(!showSchedule)}
                                    >
                                        {showSchedule ? 'Hide Schedule' : 'View Schedule'}
                                    </Button>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                    <div className="p-2 rounded bg-background border">
                                        <div className="text-muted-foreground">Principal</div>
                                        <div className="font-semibold text-foreground">{formatCurrency(preview.principal)}</div>
                                    </div>
                                    <div className="p-2 rounded bg-background border">
                                        <div className="text-muted-foreground">Interest</div>
                                        <div className="font-semibold text-foreground">{formatCurrency(preview.totalInterest)}</div>
                                    </div>
                                    <div className="p-2 rounded bg-background border">
                                        <div className="text-muted-foreground">Total Repayable</div>
                                        <div className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(preview.totalRepayment)}</div>
                                    </div>
                                </div>

                                {showSchedule && preview.installments.length > 0 && (
                                    <div className="pt-2 max-h-52 overflow-y-auto border-t text-xs">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="w-12 text-center">#</TableHead>
                                                    <TableHead className="text-right">Principal</TableHead>
                                                    <TableHead className="text-right">Interest</TableHead>
                                                    <TableHead className="text-right">Total Due</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {preview.installments.map(inst => (
                                                    <TableRow key={inst.installmentNo}>
                                                        <TableCell className="text-center font-medium">{inst.installmentNo}</TableCell>
                                                        <TableCell className="text-right">{formatCurrency(inst.principal)}</TableCell>
                                                        <TableCell className="text-right">{formatCurrency(inst.interest)}</TableCell>
                                                        <TableCell className="text-right font-semibold">{formatCurrency(inst.total)}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex flex-col sm:flex-row gap-3 pt-2">
                            <Button
                                type="button"
                                variant="outline"
                                className="flex-1 gap-2"
                                disabled={savingDraft || submitting || !selectedSchemeId}
                                onClick={() => void handleSave(false)}
                            >
                                {savingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileEdit className="h-4 w-4" />}
                                Save as Draft
                            </Button>
                            <Button
                                type="button"
                                className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                                disabled={savingDraft || submitting || !selectedSchemeId || !optionsData?.workflowAvailable}
                                onClick={() => void handleSave(true)}
                            >
                                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                {editingLoan?.status === 'RETURNED' ? 'Resubmit Application' : 'Submit Application'}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* My Staff Loans Table */}
            <Card className="border shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between pb-4">
                    <div>
                        <CardTitle>My Staff Loan Applications</CardTitle>
                        <CardDescription>Track status, review decisions, and view repayment history.</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {listLoading ? (
                        <div className="p-8 text-center">
                            <PageLoader label="Loading your applications..." fullScreen={false} />
                        </div>
                    ) : applications?.items.length === 0 ? (
                        <div className="text-center py-12 text-sm text-muted-foreground">
                            <FileText className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                            You have not submitted any staff loan applications yet.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/40">
                                        <TableHead>Loan No.</TableHead>
                                        <TableHead>Scheme</TableHead>
                                        <TableHead className="text-right">Requested</TableHead>
                                        <TableHead className="text-center">Tenure</TableHead>
                                        <TableHead>Interest</TableHead>
                                        <TableHead>Recovery</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Applied On</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {applications?.items.map(row => (
                                        <TableRow key={row.id} className="hover:bg-muted/30">
                                            <TableCell className="font-medium font-mono text-xs">{row.loanNumber}</TableCell>
                                            <TableCell>{row.schemeName}</TableCell>
                                            <TableCell className="text-right font-semibold">{formatCurrency(row.requestedAmount)}</TableCell>
                                            <TableCell className="text-center">{row.tenureMonths} mo</TableCell>
                                            <TableCell>
                                                {row.interestType === 'INTEREST_FREE' ? '0% Free'
                                                    : row.interestType === 'MONTHLY' ? `${row.annualInterestRate}% Monthly`
                                                    : `${row.annualInterestRate}% Flat`}
                                            </TableCell>
                                            <TableCell>{row.recoveryMethod === 'SALARY' ? 'Salary' : 'Cash / Bank'}</TableCell>
                                            <TableCell>{getStatusBadge(row.status, row.currentStage)}</TableCell>
                                            <TableCell className="text-xs text-muted-foreground">{formatDate(row.createdAt)}</TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1.5">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-8 w-8 p-0"
                                                        title="View Details"
                                                        onClick={() => void handleViewDetail(row.id)}
                                                    >
                                                        <Eye className="h-4 w-4" />
                                                    </Button>
                                                    {['DRAFT', 'RETURNED'].includes(row.status) && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-8 w-8 p-0 text-blue-600"
                                                            title="Edit Application"
                                                            onClick={() => startEdit(row)}
                                                        >
                                                            <FileEdit className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                    {['DRAFT', 'RETURNED', 'SUBMITTED'].includes(row.status) && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-8 w-8 p-0 text-destructive"
                                                            title="Cancel Application"
                                                            onClick={() => setCancellingLoan(row)}
                                                        >
                                                            <XCircle className="h-4 w-4" />
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

            {/* Application Detail Dialog */}
            <Dialog open={!!viewId} onOpenChange={open => { if (!open) { setViewId(null); setDetailData(null); } }}>
                <DialogContent className="sm:max-w-[min(900px,95vw)] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center justify-between pr-6">
                            <span>Loan Details — {detailData?.loanNumber}</span>
                            {detailData && getStatusBadge(detailData.status, detailData.currentStage)}
                        </DialogTitle>
                        <DialogDescription>
                            Complete application information, approval workflow stages, and decision audit trail.
                        </DialogDescription>
                    </DialogHeader>

                    {detailLoading || !detailData ? (
                        <div className="py-8">
                            <PageLoader label="Loading details..." fullScreen={false} />
                        </div>
                    ) : (
                        <div className="space-y-6 pt-2">
                            {/* Summary Grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-muted/40 p-4 rounded-lg">
                                <div>
                                    <div className="text-muted-foreground">Scheme</div>
                                    <div className="font-semibold text-foreground">{detailData.schemeName}</div>
                                </div>
                                <div>
                                    <div className="text-muted-foreground">Requested Amount</div>
                                    <div className="font-semibold text-foreground">{formatCurrency(detailData.requestedAmount)}</div>
                                </div>
                                <div>
                                    <div className="text-muted-foreground">Tenure</div>
                                    <div className="font-semibold text-foreground">{detailData.tenureMonths} Months</div>
                                </div>
                                <div>
                                    <div className="text-muted-foreground">Recovery Mode</div>
                                    <div className="font-semibold text-foreground">{detailData.recoveryMethod === 'SALARY' ? 'Salary Deduction' : 'Cash / Bank'}</div>
                                </div>
                                <div>
                                    <div className="text-muted-foreground">Supporting Document</div>
                                    {detailData.document ? (
                                        <button type="button" className="flex items-center gap-1 font-semibold text-primary hover:underline" onClick={() => void handleViewDocument(detailData.id)}>
                                            <FileText className="h-3.5 w-3.5" />{detailData.document.fileName}
                                        </button>
                                    ) : (
                                        <div className="font-semibold text-foreground">Not attached</div>
                                    )}
                                </div>
                            </div>

                            {/* Purpose & Remarks */}
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
                            </div>

                            {/* Workflow Stages Progression */}
                            {detailData.stages.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Approval Stages</h4>
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
                                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Audit History</h4>
                                {detailData.decisions.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">No decisions recorded yet.</p>
                                ) : (
                                    <div className="border rounded-md overflow-hidden text-xs">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="bg-muted/40">
                                                    <TableHead>Time</TableHead>
                                                    <TableHead>Action</TableHead>
                                                    <TableHead>Actor</TableHead>
                                                    <TableHead>Remarks</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {detailData.decisions.map(d => (
                                                    <TableRow key={d.id}>
                                                        <TableCell className="text-muted-foreground">{formatDate(d.createdAt)}</TableCell>
                                                        <TableCell>
                                                            <Badge variant={d.action === 'APPROVE' ? 'default' : d.action === 'REJECT' ? 'destructive' : 'secondary'}>
                                                                {d.action}
                                                            </Badge>
                                                        </TableCell>
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
                </DialogContent>
            </Dialog>

            {/* Cancel Application Confirmation */}
            {cancellingLoan && (
                <ConfirmationDialog
                    open={!!cancellingLoan}
                    onOpenChange={open => { if (!open) setCancellingLoan(null); }}
                    title="Cancel Staff Loan Application"
                    description={`Are you sure you want to cancel application ${cancellingLoan.loanNumber}? This action cannot be undone.`}
                    confirmText="Confirm Cancel"
                    cancelText="Keep Application"
                    type="danger"
                    isLoading={cancelSubmitting}
                    onConfirm={() => void handleConfirmCancel()}
                />
            )}
        </div>
    );
}
