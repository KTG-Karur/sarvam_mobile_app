'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
    ArrowLeft, Save, Loader2, IdCard, Plus, Trash2, AlertCircle,
    User, Building2, MapPin, Landmark, ShieldCheck, Users2, History as HistoryIcon,
} from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import { Badge } from '@/components/ui/badge';
import { FieldPermission, MaskedValue } from '@/app/components/rbac/FieldPermission';
import { GENDER_OPTIONS, MARITAL_STATUS_OPTIONS, FIELD_PATTERNS, FIELD_ERROR_MESSAGES } from '@/app/lib/hr/onboarding-form-fields';
import {
    validateEmployeeField,
    EMPLOYEE_FIELD_TAB_MAP,
    filterDigits,
    filterUppercase,
} from '@/app/lib/hr/onboarding-validation-rules';
import { hasReportingHierarchy } from '@/app/lib/hr/reporting-hierarchy';
import { useHrOnboardingValidation } from '@/hooks/useHrOnboardingValidation';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';
import { useEmployeeIdCard } from '@/components/hr/useEmployeeIdCard';

type LookupOption = { id: string; name: string };
type ManagerOption = { id: string; firstName: string; lastName: string; employeeId: string | null };

type EmployeeDetail = {
    id: string;
    employeeId: string | null;
    firstName: string;
    lastName: string;
    role: string;
    isActive: boolean;
    mobileNumber: string | null;
    email: string | null;
    branch: { id: string; name: string; code: string } | null;
    shift?: { id: string; name: string; shiftStart: string; shiftEnd: string } | null;
    orgRegion?: { id: string; name: string } | null;
    orgDivision?: { id: string; name: string } | null;
    departmentId: string | null;
    department: LookupOption | null;
    designationId: string | null;
    designation: (LookupOption & { grade: number | null }) | null;
    reportingManagerL1Id: string | null;
    reportingManagerL2Id: string | null;
    reportingManagerL3Id: string | null;
    gender: string | null;
    dob: string | null;
    dateOfJoining: string | null;
    maritalStatus: string | null;
    bloodGroup: string | null;
    education: string | null;
    dlNumber?: string | null;
    voterIdNumber?: string | null;
    insuranceCompanyName?: string | null;
    insurancePolicyNumber?: string | null;
    insuranceValidFrom?: string | null;
    insuranceValidTo?: string | null;
    fatherName: string | null;
    fatherAge?: number | null;
    fatherAadhaarNumber?: string | null;
    motherName: string | null;
    motherAge?: number | null;
    motherAadhaarNumber?: string | null;
    children?: { gender: string; age: string; aadhaarNumber: string }[] | null;
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
    aadhaarNumber: string | null;
    panNumber: string | null;
    uanNumber: string | null;
    esiNumber: string | null;
    pfNumber: string | null;
    address: string | null;
    permanentAddress: string | null;
    sameAsCurrentAddress: boolean;
    emergencyContactName: string | null;
    emergencyContactRelation: string | null;
    emergencyContactMobile: string | null;
    bankName: string | null;
    bankBranchName: string | null;
    bankAccountNumber: string | null;
    bankIfscCode: string | null;
    salarySummary?: {
        monthlyCtc: number;
        yearCtc: number;
        basicPercent: number;
        hraPercent: number;
        basic: number;
        hra: number;
    };
};

type CtcHistoryRow = {
    id: string;
    effectiveDate: string;
    fromMonthlyCtc: number | null;
    toMonthlyCtc: number;
    source: 'ONBOARDING' | 'MANUAL_EDIT' | 'PROMOTION';
    changedByName: string | null;
};
type RoleHistoryRow = {
    id: string;
    effectiveDate: string;
    fromDesignationName: string | null;
    toDesignationName: string;
    approvedByName: string | null;
};

const FIELD_MODULE = 'hr-employee';

// Same tabs, labels and order as the onboarding Manual Entry form
// (OnboardingRequestForm's SECTIONS) — minus a Documents tab, since Documents
// already has its own dedicated button/page here — followed by Organization
// (not an intake tab, filled in at final approval) and History (this app's
// own addition — CTC + role change log, not part of onboarding at all).
type EmployeeTabId = 'personal' | 'address' | 'identity' | 'bank' | 'insurance' | 'family' | 'organization' | 'history';
const EMPLOYEE_TABS: { id: EmployeeTabId; label: string; icon: typeof User }[] = [
    { id: 'personal', label: 'Personal Details', icon: User },
    { id: 'address', label: 'Address', icon: MapPin },
    { id: 'identity', label: 'Identity & Statutory', icon: IdCard },
    { id: 'bank', label: 'Bank Details', icon: Landmark },
    { id: 'insurance', label: 'Vehicle Insurance', icon: ShieldCheck },
    { id: 'family', label: 'Family Details', icon: Users2 },
    { id: 'organization', label: 'Organization', icon: Building2 },
    { id: 'history', label: 'History', icon: HistoryIcon },
];

const formatCurrency = (value: number): string =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(value);
const CTC_SOURCE_LABEL: Record<CtcHistoryRow['source'], string> = {
    ONBOARDING: 'Onboarding',
    MANUAL_EDIT: 'Manual Edit',
    PROMOTION: 'Promotion',
};

function TextRow({ label, value, onChange, onBlur, type = 'text', placeholder, required, error, digitsOnly, uppercase, maxLength }: {
    label: string;
    value: string | number;
    onChange: (v: string) => void;
    onBlur?: () => void;
    type?: string;
    placeholder?: string;
    required?: boolean;
    error?: string | null;
    digitsOnly?: boolean;
    uppercase?: boolean;
    maxLength?: number;
}) {
    const handleChange = (raw: string) => {
        let val = raw;
        if (digitsOnly) val = filterDigits(val, maxLength);
        else if (uppercase) val = filterUppercase(val, maxLength);
        else if (maxLength && val.length > maxLength) val = val.slice(0, maxLength);
        onChange(val);
    };

    return (
        <div className="space-y-1.5">
            <Label className={error ? 'text-red-600 dark:text-red-400' : undefined}>
                {label}{required && <span className="text-red-500 ml-0.5">*</span>}
            </Label>
            {type === 'date' ? (
                <DateInput
                    value={String(value ?? '')}
                    onChange={(e) => handleChange(e.target.value)}
                    onBlur={onBlur}
                    className={error ? 'border-red-500 focus-visible:ring-red-500' : undefined}
                />
            ) : (
                <Input
                    type={type}
                    value={value}
                    onChange={(e) => handleChange(e.target.value)}
                    onBlur={onBlur}
                    placeholder={placeholder}
                    className={error ? 'border-red-500 focus-visible:ring-red-500' : undefined}
                />
            )}
            {error && (
                <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}
        </div>
    );
}

function SensitiveField({
    label,
    value,
    onChange,
    onBlur,
    disabled,
    fieldName,
    required,
    error,
    digitsOnly,
    uppercase,
    maxLength,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    onBlur?: () => void;
    disabled?: boolean;
    fieldName: string;
    required?: boolean;
    error?: string | null;
    digitsOnly?: boolean;
    uppercase?: boolean;
    maxLength?: number;
}) {
    const handleChange = (raw: string) => {
        let val = raw;
        if (digitsOnly) val = filterDigits(val, maxLength);
        else if (uppercase) val = filterUppercase(val, maxLength);
        else if (maxLength && val.length > maxLength) val = val.slice(0, maxLength);
        onChange(val);
    };

    return (
        <FieldPermission module={FIELD_MODULE} field={fieldName}>
            {({ access }) => (
                <div className="space-y-1.5">
                    <Label className={`text-sm font-semibold ${error ? 'text-red-600 dark:text-red-400' : 'text-sidebar-accent dark:text-slate-300'}`}>
                        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
                    </Label>
                    {access === 'MASKED' ? (
                        <div className="h-10 flex items-center px-3 rounded-md border bg-slate-50 dark:bg-sidebar-accent">
                            <MaskedValue value={value} />
                        </div>
                    ) : (
                        <Input
                            value={value}
                            onChange={(e) => handleChange(e.target.value)}
                            onBlur={onBlur}
                            disabled={disabled || access === 'READONLY'}
                            className={`bg-white dark:bg-sidebar-accent ${error ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                        />
                    )}
                    {error && (
                        <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium">
                            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}
                </div>
            )}
        </FieldPermission>
    );
}

const EMPLOYEE_VALIDATED_FIELDS = [
    'firstName', 'lastName', 'mobileNumber', 'email', 'dob', 'gender', 'maritalStatus', 'bloodGroup', 'education',
    'address', 'permanentAddress', 'emergencyContactName', 'emergencyContactRelation', 'emergencyContactMobile',
    'aadhaarNumber', 'panNumber', 'dlNumber', 'voterIdNumber', 'uanNumber', 'esiNumber', 'pfNumber',
    'bankName', 'bankBranchName', 'bankAccountNumber', 'bankIfscCode',
    'insuranceCompanyName', 'insurancePolicyNumber', 'insuranceValidFrom', 'insuranceValidTo',
    'fatherName', 'fatherAge', 'fatherAadhaarNumber', 'motherName', 'motherAge', 'motherAadhaarNumber',
    'wifeName', 'wifeAge', 'wifeAadhaarNumber', 'wifeBankAccountNumber', 'wifeIfscCode', 'wifeContactNumber',
    'husbandName', 'husbandAge', 'husbandAadhaarNumber', 'husbandBankAccountNumber', 'husbandIfscCode', 'husbandContactNumber',
    'weddingDate', 'departmentId', 'designationId', 'reportingManagerL1Id', 'dateOfJoining', 'monthlyCtc',
];

function isBlankValue(value: unknown): boolean {
    return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

export function EmployeeMasterForm({ employeeId }: { employeeId: string }) {
    const router = useRouter();
    const { toast } = useToast();
    type FormState = Partial<EmployeeDetail> & Record<string, unknown>;
    const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
    const [form, setForm] = useState<FormState>({});
    // Form as last loaded/saved — the baseline for sending only changed fields,
    // for not forcing required fields that were already empty, and for "View
    // ID Card" to warn that unsaved edits aren't on the card yet.
    const savedFormRef = useRef<FormState | null>(null);
    const savedFormJsonRef = useRef<string>('');
    const { openForEmployee: openIdCard, loadingFor: loadingIdCardFor, dialogs: idCardDialogs } = useEmployeeIdCard({
        onEmployeeMaster: true,
    });
    const isLoadingIdCard = loadingIdCardFor !== null;
    const [departments, setDepartments] = useState<LookupOption[]>([]);
    const [designations, setDesignations] = useState<LookupOption[]>([]);
    const [managers, setManagers] = useState<ManagerOption[]>([]);
    // Reporting Manager L1/L2/L3 only mean something when the configured
    // hr-onboarding approval workflow actually has that many levels — a
    // single "Admin Approval" stage has no real reporting hierarchy to
    // capture, so all three fields stay hidden until there's more than one.
    const [approvalStageCount, setApprovalStageCount] = useState<number | null>(null);
    const showReportingManagerFields = hasReportingHierarchy(approvalStageCount);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    // The actual reason the record couldn't be loaded (e.g. "You do not have
    // access to this employee") — shown instead of a blanket "not found" so a
    // permission/branch-scope denial doesn't look like the record is missing.
    const [loadError, setLoadError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<EmployeeTabId>('personal');
    const [ctcHistory, setCtcHistory] = useState<CtcHistoryRow[]>([]);
    const [roleHistory, setRoleHistory] = useState<RoleHistoryRow[]>([]);
    const [isHistoryLoading, setIsHistoryLoading] = useState(true);
    const { isRequired } = useHrOnboardingValidation();
    const req = (fieldKey: string): boolean => {
        if (isRequired(fieldKey)) return true;
        const aliases: Record<string, string[]> = {
            firstName: ['employeeName'],
            lastName: ['employeeName'],
            dob: ['dateOfBirth'],
            education: ['educationQualification'],
            address: ['currentAddress'],
            emergencyContactMobile: ['emergencyContactNumber'],
            bankAccountNumber: ['accountNumber'],
            bankIfscCode: ['ifscCode'],
            branchId: ['branchId'],
            reportingManagerL1Id: ['reportingManagerId'],
        };
        const mapped = aliases[fieldKey];
        if (mapped && mapped.some((k) => isRequired(k))) return true;
        return false;
    };

    const [errors, setErrors] = useState<Record<string, string>>({});

    const set = (key: string, value: unknown) => {
        setForm((prev) => ({ ...prev, [key]: value }));
        setErrors((prev) => {
            if (!prev[key]) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
        });
    };

    const handleBlur = (fieldKey: string) => {
        const err = validateEmployeeField(fieldKey, form[fieldKey], {
            maritalStatus: form.maritalStatus as string,
            gender: form.gender as string,
            insuranceValidFrom: form.insuranceValidFrom as string,
            isRequired: req(fieldKey),
        });
        setErrors((prev) => {
            const next = { ...prev };
            if (err) next[fieldKey] = err;
            else delete next[fieldKey];
            return next;
        });
    };

    type ChildEntry = { gender: string; age: string; aadhaarNumber: string };
    const children: ChildEntry[] = form.children || [];
    const addChild = () => set('children', [...children, { gender: '', age: '', aadhaarNumber: '' }]);
    const updateChild = (index: number, patch: Partial<ChildEntry>) => {
        const updated = children.map((c, i) => (i === index ? { ...c, ...patch } : c));
        set('children', updated);
        if (patch.aadhaarNumber !== undefined && errors[`children.${index}.aadhaarNumber`]) {
            setErrors((prev) => {
                const next = { ...prev };
                delete next[`children.${index}.aadhaarNumber`];
                return next;
            });
        }
    };
    const removeChild = (index: number) => {
        set('children', children.filter((_, i) => i !== index));
        setErrors((prev) => {
            const next = { ...prev };
            delete next[`children.${index}.aadhaarNumber`];
            return next;
        });
    };

    const fetchEmployee = useCallback(async () => {
        try {
            const res = await apiClient.get<EmployeeDetail>(`/hr/employees/${employeeId}`);
            if (res.success && res.data) {
                setEmployee(res.data);
                const loadedForm: FormState = {
                    ...res.data,
                    gender: res.data.gender ? res.data.gender.toUpperCase() : '',
                    maritalStatus: res.data.maritalStatus ? res.data.maritalStatus.toUpperCase() : '',
                    // Records saved with "same as current" only stored the flag —
                    // carry the effective address into the now-independent field.
                    permanentAddress: res.data.permanentAddress || (res.data.sameAsCurrentAddress ? res.data.address : '') || '',
                    dob: res.data.dob ? res.data.dob.substring(0, 10) : '',
                    dateOfJoining: res.data.dateOfJoining ? res.data.dateOfJoining.substring(0, 10) : '',
                    weddingDate: res.data.weddingDate ? res.data.weddingDate.substring(0, 10) : '',
                    insuranceValidFrom: res.data.insuranceValidFrom ? res.data.insuranceValidFrom.substring(0, 10) : '',
                    insuranceValidTo: res.data.insuranceValidTo ? res.data.insuranceValidTo.substring(0, 10) : '',
                    children: res.data.children ?? [],
                    // '' (not 0) when no CTC exists yet, so the required-field
                    // check can tell "not entered" apart from a real value.
                    monthlyCtc: res.data.salarySummary?.monthlyCtc ?? '',
                };
                setForm(loadedForm);
                savedFormRef.current = loadedForm;
                savedFormJsonRef.current = JSON.stringify(loadedForm);
            } else {
                setLoadError(res.error || 'Employee not found.');
                toast({ title: 'Error', description: res.error || 'Employee not found.', variant: 'destructive' });
            }
        } catch {
            setLoadError('Failed to fetch employee.');
            toast({ title: 'Error', description: 'Failed to fetch employee.', variant: 'destructive' });
        } finally {
            setIsInitialLoading(false);
        }
    }, [employeeId, toast]);

    const fetchLookups = useCallback(async () => {
        const [deptRes, desigRes, managersRes, approvalLevelsRes] = await Promise.all([
            apiClient.get<LookupOption[]>('/hr/departments'),
            apiClient.get<LookupOption[]>('/hr/designations'),
            apiClient.get<ManagerOption[]>('/hr/employees'),
            apiClient.get<{ stageCount: number }>('/hr/onboarding/approval-levels'),
        ]);
        if (deptRes.success && deptRes.data) setDepartments(deptRes.data);
        if (desigRes.success && desigRes.data) setDesignations(desigRes.data);
        // Excludes the employee themselves below (render time) — fetched here
        // unfiltered since the employeeId to exclude isn't known until
        // fetchEmployee also resolves.
        if (managersRes.success && managersRes.data) setManagers(managersRes.data);
        if (approvalLevelsRes.success && approvalLevelsRes.data) {
            setApprovalStageCount(approvalLevelsRes.data.stageCount);
        }
    }, []);

    const fetchHistory = useCallback(async () => {
        setIsHistoryLoading(true);
        try {
            const res = await apiClient.get<{ ctcHistory: CtcHistoryRow[]; roleHistory: RoleHistoryRow[] }>(`/hr/employees/${employeeId}/history`);
            if (res.success && res.data) {
                setCtcHistory(res.data.ctcHistory);
                setRoleHistory(res.data.roleHistory);
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch employee history.', variant: 'destructive' });
        } finally {
            setIsHistoryLoading(false);
        }
    }, [employeeId, toast]);

    useEffect(() => {
        fetchEmployee();
        fetchLookups();
        fetchHistory();
    }, [fetchEmployee, fetchLookups, fetchHistory]);

    // Derived once here (not just at render time) so handleSave can gate the
    // wife/husband/weddingDate payload fields on the exact same rules the UI
    // uses to show/hide them — otherwise a section that becomes hidden (e.g.
    // gender changed away from Male, or marital status changed to Single)
    // leaves its stale values sitting in `form` state, silently re-saved on
    // every future edit with no way for the user to see or clear them.
    const normalizedMaritalStatus = (form.maritalStatus || '').trim().toUpperCase();
    const normalizedGender = (form.gender || '').trim().toUpperCase();
    // Only currently married employees show spouse fields, Wedding Date, and Children.
    // Single, Divorced, Widowed, or unselected all hide spouse/children fields.
    const isMarried = normalizedMaritalStatus === 'MARRIED';
    const isMale = normalizedGender === 'MALE';
    const isFemale = normalizedGender === 'FEMALE';
    const showWifeFields = isMarried && isMale;
    const showHusbandFields = isMarried && isFemale;

    // A required field that was already empty when the record loaded and is
    // still empty isn't forced on this save. Staff created outside onboarding
    // (Add User, legacy imports) start with most fields blank; demanding all of
    // them at once meant HR couldn't save any one correction. Format checks
    // still run on everything, and a filled field can't be blanked.
    const isUntouchedEmpty = (key: string): boolean =>
        isBlankValue(savedFormRef.current?.[key]) && isBlankValue(form[key]);

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        for (const key of EMPLOYEE_VALIDATED_FIELDS) {
            const err = validateEmployeeField(key, form[key], {
                maritalStatus: form.maritalStatus as string,
                gender: form.gender as string,
                insuranceValidFrom: form.insuranceValidFrom as string,
                isRequired: req(key) && !isUntouchedEmpty(key),
            });
            if (err) {
                newErrors[key] = err;
            }
        }

        if (isMarried && children.length > 0) {
            children.forEach((c, idx) => {
                if (c.aadhaarNumber && c.aadhaarNumber.trim() !== '') {
                    if (!FIELD_PATTERNS.AADHAAR.test(c.aadhaarNumber.trim())) {
                        newErrors[`children.${idx}.aadhaarNumber`] = FIELD_ERROR_MESSAGES.CHILD_AADHAAR;
                    }
                }
            });
        }

        setErrors(newErrors);
        const errorKeys = Object.keys(newErrors);
        if (errorKeys.length > 0) {
            const firstKey = errorKeys[0];
            const targetTab = firstKey.startsWith('children.') ? 'family' : EMPLOYEE_FIELD_TAB_MAP[firstKey];
            if (targetTab) {
                setActiveTab(targetTab);
            }
            return false;
        }
        return true;
    };

    const getTabErrorCount = (tabId: EmployeeTabId): number => {
        return Object.entries(errors).filter(([key, msg]) => {
            if (!msg) return false;
            if (key.startsWith('children.')) return tabId === 'family';
            return EMPLOYEE_FIELD_TAB_MAP[key] === tabId;
        }).length;
    };

    // PATCH body for a given form state. Spouse/children visibility is derived
    // from `f` itself (not the live render flags) so the loaded baseline and
    // the current form are normalised by the same rules before being diffed.
    const buildPayload = (f: FormState): Record<string, unknown> => {
        const married = (f.maritalStatus || '').trim().toUpperCase() === 'MARRIED';
        const gender = (f.gender || '').trim().toUpperCase();
        const wife = married && gender === 'MALE';
        const husband = married && gender === 'FEMALE';
        return {
            firstName: f.firstName,
            lastName: f.lastName,
            mobileNumber: f.mobileNumber || null,
            email: f.email || null,
            departmentId: f.departmentId || null,
            designationId: f.designationId || null,
            reportingManagerL1Id: f.reportingManagerL1Id || null,
            reportingManagerL2Id: f.reportingManagerL2Id || null,
            reportingManagerL3Id: f.reportingManagerL3Id || null,
            gender: f.gender || null,
            dob: f.dob || null,
            dateOfJoining: f.dateOfJoining || null,
            maritalStatus: f.maritalStatus || null,
            bloodGroup: f.bloodGroup || null,
            education: f.education || null,
            dlNumber: f.dlNumber || null,
            voterIdNumber: f.voterIdNumber || null,
            insuranceCompanyName: f.insuranceCompanyName || null,
            insurancePolicyNumber: f.insurancePolicyNumber || null,
            insuranceValidFrom: f.insuranceValidFrom || null,
            insuranceValidTo: f.insuranceValidTo || null,
            fatherName: f.fatherName || null,
            fatherAge: f.fatherAge ? Number(f.fatherAge) : null,
            fatherAadhaarNumber: f.fatherAadhaarNumber || null,
            motherName: f.motherName || null,
            motherAge: f.motherAge ? Number(f.motherAge) : null,
            motherAadhaarNumber: f.motherAadhaarNumber || null,
            children: !married ? [] : (f.children || []),
            wifeName: wife ? (f.wifeName || null) : null,
            wifeAge: wife && f.wifeAge ? Number(f.wifeAge) : null,
            wifeAadhaarNumber: wife ? (f.wifeAadhaarNumber || null) : null,
            wifeBankAccountNumber: wife ? (f.wifeBankAccountNumber || null) : null,
            wifeIfscCode: wife ? (f.wifeIfscCode || null) : null,
            wifeContactNumber: wife ? (f.wifeContactNumber || null) : null,
            husbandName: husband ? (f.husbandName || null) : null,
            husbandAge: husband && f.husbandAge ? Number(f.husbandAge) : null,
            husbandAadhaarNumber: husband ? (f.husbandAadhaarNumber || null) : null,
            husbandBankAccountNumber: husband ? (f.husbandBankAccountNumber || null) : null,
            husbandIfscCode: husband ? (f.husbandIfscCode || null) : null,
            husbandContactNumber: husband ? (f.husbandContactNumber || null) : null,
            weddingDate: !married ? null : (f.weddingDate || null),
            aadhaarNumber: f.aadhaarNumber || null,
            panNumber: f.panNumber || null,
            uanNumber: f.uanNumber || null,
            esiNumber: f.esiNumber || null,
            pfNumber: f.pfNumber || null,
            address: f.address || null,
            permanentAddress: f.permanentAddress || null,
            emergencyContactName: f.emergencyContactName || null,
            emergencyContactRelation: f.emergencyContactRelation || null,
            emergencyContactMobile: f.emergencyContactMobile || null,
            bankName: f.bankName || null,
            bankBranchName: f.bankBranchName || null,
            bankAccountNumber: f.bankAccountNumber || null,
            bankIfscCode: f.bankIfscCode || null,
            ...(f.monthlyCtc !== undefined ? { monthlyCtc: Number(f.monthlyCtc) || 0 } : {}),
        };
    };

    // Required fields still blank after this save (same applicability rules as validateForm).
    const countEmptyRequired = (): number =>
        EMPLOYEE_VALIDATED_FIELDS.filter(
            (key) =>
                req(key) &&
                isBlankValue(form[key]) &&
                validateEmployeeField(key, form[key], {
                    maritalStatus: form.maritalStatus as string,
                    gender: form.gender as string,
                    insuranceValidFrom: form.insuranceValidFrom as string,
                    isRequired: true,
                }) !== null
        ).length;

    const handleSave = async () => {
        if (!validateForm()) {
            toast({
                title: 'Validation Errors',
                description: 'Please review and correct the highlighted errors before saving.',
                variant: 'destructive',
            });
            return;
        }
        // Only fields that differ from the loaded record are sent, so the
        // server's required-field check (which looks only at fields in the
        // payload) applies to what HR actually changed.
        const payload = buildPayload(form);
        const baseline = savedFormRef.current ? buildPayload(savedFormRef.current) : null;
        const changes: Record<string, unknown> = baseline
            ? Object.fromEntries(
                  Object.entries(payload).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(baseline[key]))
              )
            : payload;
        // Legacy "same as current address" records only stored the flag; the
        // form carries the effective address into permanentAddress, so persist
        // that (and clear the flag) whenever such a record is saved.
        if (baseline && employee?.sameAsCurrentAddress) {
            changes.permanentAddress = payload.permanentAddress;
            changes.sameAsCurrentAddress = false;
        }
        if (Object.keys(changes).length === 0) {
            toast({ title: 'No changes', description: 'Nothing has been changed since the last save.' });
            return;
        }

        setIsSaving(true);
        try {
            const res = await apiClient.patch<EmployeeDetail>(`/hr/employees/${employeeId}`, changes);
            if (res.success) {
                const stillEmpty = countEmptyRequired();
                toast({
                    title: 'Saved',
                    description:
                        stillEmpty > 0
                            ? `Employee record updated. ${stillEmpty} required field${stillEmpty === 1 ? ' is' : 's are'} still empty — complete the profile when the details are available.`
                            : 'Employee record updated successfully.',
                });
                await fetchEmployee();
                await fetchHistory();
            } else {
                throw new Error(res.error || 'Update failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Update failed.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };


    const handleViewIdCard = async () => {
        if (JSON.stringify(form) !== savedFormJsonRef.current) {
            toast({
                title: 'Unsaved changes',
                description: 'The ID card shows the last saved details — save first to include your edits.',
            });
        }
        await openIdCard(employeeId);
    };

    if (isInitialLoading) {
        return <PageLoader label="Loading Employee..." fullScreen={false} />;
    }

    if (!employee) {
        return (
            <div className="mx-auto max-w-3xl py-12 text-center text-slate-500">
                {loadError || 'Employee not found.'}
            </div>
        );
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-5xl space-y-6">
                <div className="mb-8 flex items-center justify-between mt-4">
                    <div className="flex items-center gap-4">
                        <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard/hr/employees')}>
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <IdCard className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white flex items-center gap-2">
                                {employee.firstName} {employee.lastName}
                                <Badge variant={employee.isActive ? 'default' : 'outline'}>
                                    {employee.isActive ? 'Active' : 'Inactive'}
                                </Badge>
                            </h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                {employee.employeeId || '—'} · {employee.branch?.name || '—'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <Button type="button" variant="outline" onClick={handleViewIdCard} disabled={isLoadingIdCard}>
                            {isLoadingIdCard ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <IdCard className="h-4 w-4 mr-2" />}
                            View ID Card
                        </Button>
                        <Button onClick={handleSave} disabled={isSaving} className="bg-primary text-white">
                            {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                            Save Changes
                        </Button>
                    </div>
                </div>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardContent className="p-6">
                        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as EmployeeTabId)}>
                            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-1.5 mb-2">
                                {EMPLOYEE_TABS.map((tab) => {
                                    const Icon = tab.icon;
                                    const active = activeTab === tab.id;
                                    const errorCount = getTabErrorCount(tab.id);
                                    return (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            onClick={() => setActiveTab(tab.id)}
                                            className={`relative flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs transition-colors ${
                                                active
                                                    ? errorCount > 0
                                                        ? 'border-red-500 bg-red-50/80 text-red-700 font-semibold ring-1 ring-red-500 dark:bg-red-950/40 dark:text-red-400'
                                                        : 'border-primary bg-primary/10 text-primary font-medium'
                                                    : errorCount > 0
                                                    ? 'border-red-300 text-red-700 bg-red-50/50 dark:border-red-900/50 dark:text-red-400'
                                                    : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-sidebar-accent dark:text-slate-400'
                                            }`}
                                        >
                                            <div className="flex items-center gap-1.5">
                                                <Icon className="h-4 w-4" />
                                                {errorCount > 0 && (
                                                    <div className="flex items-center gap-1">
                                                        <AlertCircle className="h-3 w-3 text-red-600 dark:text-red-400 shrink-0" />
                                                        <span className="inline-flex items-center justify-center rounded-full bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400 font-semibold px-1.5 py-0.2 text-[10px] min-w-4 h-4">
                                                            {errorCount}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                            <span>{tab.label}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            <TabsContent value="personal" className="space-y-6 pt-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <TextRow
                                        label="First Name"
                                        value={form.firstName || ''}
                                        onChange={(v) => set('firstName', v)}
                                        onBlur={() => handleBlur('firstName')}
                                        required={req('firstName')}
                                        error={errors.firstName}
                                    />
                                    <TextRow
                                        label="Last Name"
                                        value={form.lastName || ''}
                                        onChange={(v) => set('lastName', v)}
                                        onBlur={() => handleBlur('lastName')}
                                        required={req('lastName')}
                                        error={errors.lastName}
                                    />
                                    <TextRow
                                        label="Mobile Number"
                                        value={form.mobileNumber || ''}
                                        onChange={(v) => set('mobileNumber', v)}
                                        onBlur={() => handleBlur('mobileNumber')}
                                        required={req('mobileNumber')}
                                        error={errors.mobileNumber}
                                        digitsOnly
                                        maxLength={10}
                                        placeholder="10-digit mobile number"
                                    />
                                    <TextRow
                                        label="Email ID"
                                        value={form.email || ''}
                                        onChange={(v) => set('email', v)}
                                        onBlur={() => handleBlur('email')}
                                        required={req('email')}
                                        error={errors.email}
                                        placeholder="name@example.com"
                                    />
                                    <TextRow
                                        label="Date of Birth"
                                        type="date"
                                        value={form.dob || ''}
                                        onChange={(v) => set('dob', v)}
                                        onBlur={() => handleBlur('dob')}
                                        required={req('dob')}
                                        error={errors.dob}
                                    />
                                    <div className="space-y-2">
                                        <Label className={errors.gender ? 'text-red-600 dark:text-red-400' : undefined}>
                                            Gender{req('gender') && <span className="text-red-500 ml-0.5">*</span>}
                                        </Label>
                                        <Select
                                            value={form.gender || ''}
                                            onValueChange={(v) => {
                                                set('gender', v);
                                                if (errors.gender) {
                                                    setErrors((prev) => {
                                                        const next = { ...prev };
                                                        delete next.gender;
                                                        return next;
                                                    });
                                                }
                                            }}
                                        >
                                            <SelectTrigger className={errors.gender ? 'border-red-500 focus:ring-red-500' : undefined}>
                                                <SelectValue placeholder="Select gender" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {GENDER_OPTIONS.map((o) => (
                                                    <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {errors.gender && (
                                            <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                                                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                                <span>{errors.gender}</span>
                                            </p>
                                        )}
                                    </div>
                                    <div className="space-y-2">
                                        <Label className={errors.maritalStatus ? 'text-red-600 dark:text-red-400' : undefined}>
                                            Marital Status{req('maritalStatus') && <span className="text-red-500 ml-0.5">*</span>}
                                        </Label>
                                        <Select
                                            value={form.maritalStatus || ''}
                                            onValueChange={(v) => {
                                                set('maritalStatus', v);
                                                if (errors.maritalStatus) {
                                                    setErrors((prev) => {
                                                        const next = { ...prev };
                                                        delete next.maritalStatus;
                                                        return next;
                                                    });
                                                }
                                            }}
                                        >
                                            <SelectTrigger className={errors.maritalStatus ? 'border-red-500 focus:ring-red-500' : undefined}>
                                                <SelectValue placeholder="Select marital status" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {MARITAL_STATUS_OPTIONS.map((o) => (
                                                    <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {errors.maritalStatus && (
                                            <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                                                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                                <span>{errors.maritalStatus}</span>
                                            </p>
                                        )}
                                    </div>
                                    <TextRow
                                        label="Blood Group"
                                        value={form.bloodGroup || ''}
                                        onChange={(v) => set('bloodGroup', v)}
                                        onBlur={() => handleBlur('bloodGroup')}
                                        required={req('bloodGroup')}
                                        error={errors.bloodGroup}
                                        uppercase
                                        maxLength={5}
                                        placeholder="e.g. O+"
                                    />
                                    <TextRow
                                        label="Education Qualification"
                                        value={form.education || ''}
                                        onChange={(v) => set('education', v)}
                                        onBlur={() => handleBlur('education')}
                                        required={req('education')}
                                        error={errors.education}
                                        placeholder="e.g. B.Com"
                                    />
                                </div>
                            </TabsContent>

                            <TabsContent value="address" className="space-y-6 pt-6">
                                <div className="grid grid-cols-1 gap-6">
                                    <TextRow
                                        label="Current Address"
                                        value={form.address || ''}
                                        onChange={(v) => set('address', v)}
                                        onBlur={() => handleBlur('address')}
                                        required={req('address')}
                                        error={errors.address}
                                    />
                                    <TextRow
                                        label="Permanent Address"
                                        value={form.permanentAddress || ''}
                                        onChange={(v) => set('permanentAddress', v)}
                                        onBlur={() => handleBlur('permanentAddress')}
                                        required={req('permanentAddress')}
                                        error={errors.permanentAddress}
                                    />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <TextRow
                                        label="Emergency Contact Name"
                                        value={form.emergencyContactName || ''}
                                        onChange={(v) => set('emergencyContactName', v)}
                                        onBlur={() => handleBlur('emergencyContactName')}
                                        required={req('emergencyContactName')}
                                        error={errors.emergencyContactName}
                                    />
                                    <TextRow
                                        label="Emergency Contact Relationship"
                                        value={form.emergencyContactRelation || ''}
                                        onChange={(v) => set('emergencyContactRelation', v)}
                                        onBlur={() => handleBlur('emergencyContactRelation')}
                                        required={req('emergencyContactRelation')}
                                        error={errors.emergencyContactRelation}
                                    />
                                    <TextRow
                                        label="Emergency Contact Number"
                                        value={form.emergencyContactMobile || ''}
                                        onChange={(v) => set('emergencyContactMobile', v)}
                                        onBlur={() => handleBlur('emergencyContactMobile')}
                                        required={req('emergencyContactMobile')}
                                        error={errors.emergencyContactMobile}
                                        digitsOnly
                                        maxLength={10}
                                        placeholder="10 digit mobile number"
                                    />
                                </div>
                            </TabsContent>

                            <TabsContent value="identity" className="space-y-6 pt-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <SensitiveField
                                        label="Aadhaar Number"
                                        fieldName="aadhaarNumber"
                                        value={form.aadhaarNumber || ''}
                                        onChange={(v) => set('aadhaarNumber', v)}
                                        onBlur={() => handleBlur('aadhaarNumber')}
                                        required={req('aadhaarNumber')}
                                        error={errors.aadhaarNumber}
                                        digitsOnly
                                        maxLength={12}
                                    />
                                    <SensitiveField
                                        label="PAN Number"
                                        fieldName="panNumber"
                                        value={form.panNumber || ''}
                                        onChange={(v) => set('panNumber', v)}
                                        onBlur={() => handleBlur('panNumber')}
                                        required={req('panNumber')}
                                        error={errors.panNumber}
                                        uppercase
                                        maxLength={10}
                                    />
                                    <TextRow
                                        label="DL & LLR Number"
                                        value={form.dlNumber || ''}
                                        onChange={(v) => set('dlNumber', v)}
                                        onBlur={() => handleBlur('dlNumber')}
                                        placeholder="e.g. TN38 20190001234"
                                        required={req('dlNumber')}
                                        error={errors.dlNumber}
                                        uppercase
                                    />
                                    <TextRow
                                        label="Voter ID Number"
                                        value={form.voterIdNumber || ''}
                                        onChange={(v) => set('voterIdNumber', v)}
                                        onBlur={() => handleBlur('voterIdNumber')}
                                        placeholder="e.g. ABC1234567"
                                        required={req('voterIdNumber')}
                                        error={errors.voterIdNumber}
                                        uppercase
                                    />
                                    <SensitiveField
                                        label="UAN Number"
                                        fieldName="uanNumber"
                                        value={form.uanNumber || ''}
                                        onChange={(v) => set('uanNumber', v)}
                                        onBlur={() => handleBlur('uanNumber')}
                                        required={req('uanNumber')}
                                        error={errors.uanNumber}
                                        digitsOnly
                                        maxLength={12}
                                    />
                                    <SensitiveField
                                        label="ESI Number"
                                        fieldName="esiNumber"
                                        value={form.esiNumber || ''}
                                        onChange={(v) => set('esiNumber', v)}
                                        onBlur={() => handleBlur('esiNumber')}
                                        required={req('esiNumber')}
                                        error={errors.esiNumber}
                                        digitsOnly
                                        maxLength={17}
                                    />
                                    <SensitiveField
                                        label="PF Number"
                                        fieldName="pfNumber"
                                        value={form.pfNumber || ''}
                                        onChange={(v) => set('pfNumber', v)}
                                        onBlur={() => handleBlur('pfNumber')}
                                        required={req('pfNumber')}
                                        error={errors.pfNumber}
                                        digitsOnly
                                        maxLength={12}
                                    />
                                </div>
                            </TabsContent>

                            <TabsContent value="bank" className="space-y-6 pt-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <TextRow
                                        label="Bank Name"
                                        value={form.bankName || ''}
                                        onChange={(v) => set('bankName', v)}
                                        onBlur={() => handleBlur('bankName')}
                                        required={req('bankName')}
                                        error={errors.bankName}
                                    />
                                    <TextRow
                                        label="Bank Branch Name"
                                        value={form.bankBranchName || ''}
                                        onChange={(v) => set('bankBranchName', v)}
                                        onBlur={() => handleBlur('bankBranchName')}
                                        required={req('bankBranchName')}
                                        error={errors.bankBranchName}
                                    />
                                    <SensitiveField
                                        label="Account Number"
                                        fieldName="bankAccountNumber"
                                        value={form.bankAccountNumber || ''}
                                        onChange={(v) => set('bankAccountNumber', v)}
                                        onBlur={() => handleBlur('bankAccountNumber')}
                                        required={req('bankAccountNumber')}
                                        error={errors.bankAccountNumber}
                                        digitsOnly
                                        maxLength={18}
                                    />
                                    <TextRow
                                        label="IFSC Code"
                                        value={form.bankIfscCode || ''}
                                        onChange={(v) => set('bankIfscCode', v)}
                                        onBlur={() => handleBlur('bankIfscCode')}
                                        placeholder="e.g. SBIN0001234"
                                        required={req('bankIfscCode')}
                                        error={errors.bankIfscCode}
                                        uppercase
                                        maxLength={11}
                                    />
                                </div>
                            </TabsContent>

                            <TabsContent value="insurance" className="space-y-6 pt-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <TextRow
                                        label="Insurance Company Name"
                                        value={form.insuranceCompanyName || ''}
                                        onChange={(v) => set('insuranceCompanyName', v)}
                                        onBlur={() => handleBlur('insuranceCompanyName')}
                                        placeholder="e.g. HDFC Ergo"
                                        required={req('insuranceCompanyName')}
                                        error={errors.insuranceCompanyName}
                                    />
                                    <TextRow
                                        label="Insurance Policy Number"
                                        value={form.insurancePolicyNumber || ''}
                                        onChange={(v) => set('insurancePolicyNumber', v)}
                                        onBlur={() => handleBlur('insurancePolicyNumber')}
                                        placeholder="e.g. POL123456789"
                                        required={req('insurancePolicyNumber')}
                                        error={errors.insurancePolicyNumber}
                                    />
                                    <TextRow
                                        label="Valid From Date"
                                        type="date"
                                        value={form.insuranceValidFrom || ''}
                                        onChange={(v) => set('insuranceValidFrom', v)}
                                        onBlur={() => handleBlur('insuranceValidFrom')}
                                        required={req('insuranceValidFrom')}
                                        error={errors.insuranceValidFrom}
                                    />
                                    <TextRow
                                        label="Valid To Date"
                                        type="date"
                                        value={form.insuranceValidTo || ''}
                                        onChange={(v) => set('insuranceValidTo', v)}
                                        onBlur={() => handleBlur('insuranceValidTo')}
                                        required={req('insuranceValidTo')}
                                        error={errors.insuranceValidTo}
                                    />
                                </div>
                            </TabsContent>

                            <TabsContent value="family" className="space-y-6 pt-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <TextRow
                                        label="Father Name"
                                        value={form.fatherName || ''}
                                        onChange={(v) => set('fatherName', v)}
                                        onBlur={() => handleBlur('fatherName')}
                                        required={req('fatherName')}
                                        error={errors.fatherName}
                                    />
                                    <TextRow
                                        label="Father Age"
                                        type="number"
                                        value={form.fatherAge ?? ''}
                                        onChange={(v) => set('fatherAge', v)}
                                        onBlur={() => handleBlur('fatherAge')}
                                        required={req('fatherAge')}
                                        error={errors.fatherAge}
                                    />
                                    <TextRow
                                        label="Father Aadhaar Number"
                                        value={form.fatherAadhaarNumber || ''}
                                        onChange={(v) => set('fatherAadhaarNumber', v)}
                                        onBlur={() => handleBlur('fatherAadhaarNumber')}
                                        required={req('fatherAadhaarNumber')}
                                        error={errors.fatherAadhaarNumber}
                                        digitsOnly
                                        maxLength={12}
                                    />
                                    <TextRow
                                        label="Mother Name"
                                        value={form.motherName || ''}
                                        onChange={(v) => set('motherName', v)}
                                        onBlur={() => handleBlur('motherName')}
                                        required={req('motherName')}
                                        error={errors.motherName}
                                    />
                                    <TextRow
                                        label="Mother Age"
                                        type="number"
                                        value={form.motherAge ?? ''}
                                        onChange={(v) => set('motherAge', v)}
                                        onBlur={() => handleBlur('motherAge')}
                                        required={req('motherAge')}
                                        error={errors.motherAge}
                                    />
                                    <TextRow
                                        label="Mother Aadhaar Number"
                                        value={form.motherAadhaarNumber || ''}
                                        onChange={(v) => set('motherAadhaarNumber', v)}
                                        onBlur={() => handleBlur('motherAadhaarNumber')}
                                        required={req('motherAadhaarNumber')}
                                        error={errors.motherAadhaarNumber}
                                        digitsOnly
                                        maxLength={12}
                                    />
                                    {showWifeFields && (
                                        <>
                                            <TextRow
                                                label="Spouse Name"
                                                value={form.wifeName || ''}
                                                onChange={(v) => set('wifeName', v)}
                                                onBlur={() => handleBlur('wifeName')}
                                                required={req('wifeName')}
                                                error={errors.wifeName}
                                            />
                                            <TextRow
                                                label="Spouse Age"
                                                type="number"
                                                value={form.wifeAge ?? ''}
                                                onChange={(v) => set('wifeAge', v)}
                                                onBlur={() => handleBlur('wifeAge')}
                                                required={req('wifeAge')}
                                                error={errors.wifeAge}
                                            />
                                            <TextRow
                                                label="Spouse Aadhaar Number"
                                                value={form.wifeAadhaarNumber || ''}
                                                onChange={(v) => set('wifeAadhaarNumber', v)}
                                                onBlur={() => handleBlur('wifeAadhaarNumber')}
                                                required={req('wifeAadhaarNumber')}
                                                error={errors.wifeAadhaarNumber}
                                                digitsOnly
                                                maxLength={12}
                                            />
                                            <TextRow
                                                label="Spouse Bank Account Number"
                                                value={form.wifeBankAccountNumber || ''}
                                                onChange={(v) => set('wifeBankAccountNumber', v)}
                                                onBlur={() => handleBlur('wifeBankAccountNumber')}
                                                required={req('wifeBankAccountNumber')}
                                                error={errors.wifeBankAccountNumber}
                                                digitsOnly
                                                maxLength={18}
                                            />
                                            <TextRow
                                                label="Spouse IFSC Code"
                                                value={form.wifeIfscCode || ''}
                                                onChange={(v) => set('wifeIfscCode', v)}
                                                onBlur={() => handleBlur('wifeIfscCode')}
                                                placeholder="e.g. SBIN0001234"
                                                required={req('wifeIfscCode')}
                                                error={errors.wifeIfscCode}
                                                uppercase
                                                maxLength={11}
                                            />
                                            <TextRow
                                                label="Spouse Contact Number"
                                                value={form.wifeContactNumber || ''}
                                                onChange={(v) => set('wifeContactNumber', v)}
                                                onBlur={() => handleBlur('wifeContactNumber')}
                                                required={req('wifeContactNumber')}
                                                error={errors.wifeContactNumber}
                                                digitsOnly
                                                maxLength={10}
                                                placeholder="10 digit mobile number"
                                            />
                                            <TextRow
                                                label="Wedding Date"
                                                type="date"
                                                value={form.weddingDate || ''}
                                                onChange={(v) => set('weddingDate', v)}
                                                onBlur={() => handleBlur('weddingDate')}
                                                required={req('weddingDate')}
                                                error={errors.weddingDate}
                                            />
                                        </>
                                    )}
                                    {showHusbandFields && (
                                        <>
                                            <TextRow
                                                label="Spouse Name"
                                                value={form.husbandName || ''}
                                                onChange={(v) => set('husbandName', v)}
                                                onBlur={() => handleBlur('husbandName')}
                                                required={req('husbandName')}
                                                error={errors.husbandName}
                                            />
                                            <TextRow
                                                label="Spouse Age"
                                                type="number"
                                                value={form.husbandAge ?? ''}
                                                onChange={(v) => set('husbandAge', v)}
                                                onBlur={() => handleBlur('husbandAge')}
                                                required={req('husbandAge')}
                                                error={errors.husbandAge}
                                            />
                                            <TextRow
                                                label="Spouse Aadhaar Number"
                                                value={form.husbandAadhaarNumber || ''}
                                                onChange={(v) => set('husbandAadhaarNumber', v)}
                                                onBlur={() => handleBlur('husbandAadhaarNumber')}
                                                required={req('husbandAadhaarNumber')}
                                                error={errors.husbandAadhaarNumber}
                                                digitsOnly
                                                maxLength={12}
                                            />
                                            <TextRow
                                                label="Spouse Bank Account Number"
                                                value={form.husbandBankAccountNumber || ''}
                                                onChange={(v) => set('husbandBankAccountNumber', v)}
                                                onBlur={() => handleBlur('husbandBankAccountNumber')}
                                                required={req('husbandBankAccountNumber')}
                                                error={errors.husbandBankAccountNumber}
                                                digitsOnly
                                                maxLength={18}
                                            />
                                            <TextRow
                                                label="Spouse IFSC Code"
                                                value={form.husbandIfscCode || ''}
                                                onChange={(v) => set('husbandIfscCode', v)}
                                                onBlur={() => handleBlur('husbandIfscCode')}
                                                placeholder="e.g. SBIN0001234"
                                                required={req('husbandIfscCode')}
                                                error={errors.husbandIfscCode}
                                                uppercase
                                                maxLength={11}
                                            />
                                            <TextRow
                                                label="Spouse Contact Number"
                                                value={form.husbandContactNumber || ''}
                                                onChange={(v) => set('husbandContactNumber', v)}
                                                onBlur={() => handleBlur('husbandContactNumber')}
                                                required={req('husbandContactNumber')}
                                                error={errors.husbandContactNumber}
                                                digitsOnly
                                                maxLength={10}
                                                placeholder="10 digit mobile number"
                                            />
                                            <TextRow
                                                label="Wedding Date"
                                                type="date"
                                                value={form.weddingDate || ''}
                                                onChange={(v) => set('weddingDate', v)}
                                                onBlur={() => handleBlur('weddingDate')}
                                                required={req('weddingDate')}
                                                error={errors.weddingDate}
                                            />
                                        </>
                                    )}
                                    {isMarried && !showWifeFields && !showHusbandFields && (
                                        <TextRow
                                            label="Wedding Date"
                                            type="date"
                                            value={form.weddingDate || ''}
                                            onChange={(v) => set('weddingDate', v)}
                                            onBlur={() => handleBlur('weddingDate')}
                                            required={req('weddingDate')}
                                            error={errors.weddingDate}
                                        />
                                    )}
                                </div>

                                {isMarried && (
                                    <div className="space-y-3 pt-2">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Children</Label>
                                            <Button type="button" size="sm" variant="outline" onClick={addChild} className="gap-1.5">
                                                <Plus className="h-3.5 w-3.5" /> Add Child
                                            </Button>
                                        </div>
                                        {children.length === 0 ? (
                                            <p className="text-sm text-slate-400">No children added.</p>
                                        ) : (
                                            <div className="space-y-3">
                                                {children.map((child, index) => {
                                                    const childAadhaarErr = errors[`children.${index}.aadhaarNumber`];
                                                    return (
                                                        <div key={index} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end rounded-md border p-3 bg-white dark:bg-sidebar-accent">
                                                            <div className="space-y-2">
                                                                <Label className="text-xs">Gender</Label>
                                                                <Select value={child.gender || ''} onValueChange={(v) => updateChild(index, { gender: v })}>
                                                                    <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                                                                    <SelectContent>
                                                                        {GENDER_OPTIONS.map((o) => (
                                                                            <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                            <div className="space-y-2">
                                                                <Label className="text-xs">Age</Label>
                                                                <Input value={child.age} onChange={(e) => updateChild(index, { age: e.target.value })} type="number" />
                                                            </div>
                                                            <div className="space-y-2">
                                                                <Label className={`text-xs ${childAadhaarErr ? 'text-red-600 dark:text-red-400 font-medium' : ''}`}>Aadhaar Number</Label>
                                                                <Input
                                                                    value={child.aadhaarNumber}
                                                                    onChange={(e) => updateChild(index, { aadhaarNumber: filterDigits(e.target.value, 12) })}
                                                                    className={childAadhaarErr ? 'border-red-500 focus-visible:ring-red-500' : ''}
                                                                />
                                                                {childAadhaarErr && (
                                                                    <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium">
                                                                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                                                                        <span>{childAadhaarErr}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <Button type="button" size="sm" variant="ghost" onClick={() => removeChild(index)} className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 justify-self-start">
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </TabsContent>

                            {/* Organization is not an intake tab — it is filled in at final approval — so
                                it comes last, matching the field-validation page and My Profile. */}
                            <TabsContent value="organization" className="space-y-6 pt-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <Label>Branch</Label>
                                        <Input value={employee.branch?.name || '—'} disabled className="bg-slate-50 dark:bg-sidebar-accent" />
                                        <p className="text-xs text-slate-400">Changed via Employee Transfer, not here.</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Region</Label>
                                        <Input value={employee.orgRegion?.name || '—'} disabled className="bg-slate-50 dark:bg-sidebar-accent" />
                                        <p className="text-xs text-slate-400">Set when the employee request was raised.</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Division</Label>
                                        <Input value={employee.orgDivision?.name || '—'} disabled className="bg-slate-50 dark:bg-sidebar-accent" />
                                        <p className="text-xs text-slate-400">Set when the employee request was raised.</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Shift</Label>
                                        <Input value={employee.shift ? `${employee.shift.name} (${employee.shift.shiftStart}–${employee.shift.shiftEnd})` : 'Default shift'} disabled className="bg-slate-50 dark:bg-sidebar-accent" />
                                        <p className="text-xs text-slate-400">Changed via Shift Management.</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className={errors.departmentId ? 'text-red-600 dark:text-red-400' : undefined}>Department{req('departmentId') && <span className="text-red-500 ml-0.5">*</span>}</Label>
                                        <Select value={form.departmentId || ''} onValueChange={(v) => set('departmentId', v)}>
                                            <SelectTrigger className={errors.departmentId ? 'border-red-500 focus:ring-red-500' : undefined}><SelectValue placeholder="Select department" /></SelectTrigger>
                                            <SelectContent>
                                                {departments.map((d) => (
                                                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {errors.departmentId && (
                                            <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium">
                                                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                                                <span>{errors.departmentId}</span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="space-y-2">
                                        <Label className={errors.designationId ? 'text-red-600 dark:text-red-400' : undefined}>Designation{req('designationId') && <span className="text-red-500 ml-0.5">*</span>}</Label>
                                        <Select value={form.designationId || ''} onValueChange={(v) => set('designationId', v)}>
                                            <SelectTrigger className={errors.designationId ? 'border-red-500 focus:ring-red-500' : undefined}><SelectValue placeholder="Select designation" /></SelectTrigger>
                                            <SelectContent>
                                                {designations.map((d) => (
                                                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {errors.designationId && (
                                            <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium">
                                                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                                                <span>{errors.designationId}</span>
                                            </div>
                                        )}
                                    </div>
                                    {showReportingManagerFields && (['L1', 'L2', 'L3'] as const).map((level) => {
                                        const key = `reportingManager${level}Id`;
                                        const isRequiredManager = level === 'L1' && req('reportingManagerL1Id');
                                        const managerErr = errors[key];
                                        return (
                                            <div key={level} className="space-y-2">
                                                <Label className={managerErr ? 'text-red-600 dark:text-red-400' : undefined}>Reporting Manager ({level}){isRequiredManager && <span className="text-red-500 ml-0.5">*</span>}</Label>
                                                <Select value={(form[key] as string) || ''} onValueChange={(v) => set(key, v)}>
                                                    <SelectTrigger className={managerErr ? 'border-red-500 focus:ring-red-500' : undefined}><SelectValue placeholder="Select manager" /></SelectTrigger>
                                                    <SelectContent>
                                                        {managers.filter((m) => m.id !== employee.id).map((m) => (
                                                            <SelectItem key={m.id} value={m.id}>
                                                                {m.firstName} {m.lastName}{m.employeeId ? ` (${m.employeeId})` : ''}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                {managerErr && (
                                                    <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium">
                                                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                                                        <span>{managerErr}</span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    <TextRow
                                        label="Date of Joining"
                                        type="date"
                                        value={form.dateOfJoining || ''}
                                        onChange={(v) => set('dateOfJoining', v)}
                                        onBlur={() => handleBlur('dateOfJoining')}
                                        required={req('dateOfJoining')}
                                        error={errors.dateOfJoining}
                                    />
                                    <div className="space-y-2">
                                        <Label>Role</Label>
                                        <Input value={employee.role} disabled className="bg-slate-50 dark:bg-sidebar-accent" />
                                    </div>
                                </div>

                                <div className="border-t border-gray-100 dark:border-sidebar-accent pt-6 space-y-4">
                                    <h3 className="text-sm font-semibold text-foreground dark:text-slate-100">Compensation</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-2">
                                            <Label className={errors.monthlyCtc ? 'text-red-600 dark:text-red-400' : undefined}>
                                                Month CTC Pay{req('monthlyCtc') && <span className="text-red-500 ml-0.5">*</span>}
                                            </Label>
                                            <Input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={(form.monthlyCtc as number | '' | undefined) ?? ''}
                                                onChange={(e) => set('monthlyCtc', e.target.value === '' ? '' : Number(e.target.value))}
                                                onBlur={() => handleBlur('monthlyCtc')}
                                                className={errors.monthlyCtc ? 'border-red-500 focus-visible:ring-red-500' : undefined}
                                            />
                                            {errors.monthlyCtc && (
                                                <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium">
                                                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                                                    <span>{errors.monthlyCtc}</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Year CTC</Label>
                                            <Input
                                                value={formatCurrency(Number(form.monthlyCtc || 0) * 12)}
                                                disabled
                                                className="bg-slate-50 dark:bg-sidebar-accent"
                                            />
                                        </div>
                                    </div>
                                    {employee.salarySummary && (
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                            <div>
                                                <p className="text-xs text-slate-500">Basic ({employee.salarySummary.basicPercent}%)</p>
                                                <p className="font-semibold">{formatCurrency(employee.salarySummary.basic)}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-slate-500">HRA ({employee.salarySummary.hraPercent}%)</p>
                                                <p className="font-semibold">{formatCurrency(employee.salarySummary.hra)}</p>
                                            </div>
                                        </div>
                                    )}
                                    <p className="text-xs text-slate-400">
                                        PF, ESI, Other Deductions, Incentive, Arrear and Staff Advance are managed on{' '}
                                        <button type="button" className="underline text-primary" onClick={() => router.push('/dashboard/hr/salary-master')}>
                                            Salary Master
                                        </button>.
                                    </p>
                                </div>
                            </TabsContent>

                            <TabsContent value="history" className="space-y-8 pt-6">
                                {isHistoryLoading ? (
                                    <PageLoader label="Loading history..." fullScreen={false} />
                                ) : (
                                    <>
                                        <div className="space-y-3">
                                            <h3 className="text-sm font-semibold text-foreground dark:text-slate-100">CTC Change History</h3>
                                            {ctcHistory.length === 0 ? (
                                                <p className="text-sm text-slate-500 dark:text-slate-400">No CTC changes recorded yet.</p>
                                            ) : (
                                                <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-sidebar-accent">
                                                    <table className="w-full text-sm">
                                                        <thead className="bg-gray-50 dark:bg-sidebar-accent/40">
                                                            <tr>
                                                                <th className="px-4 py-2 text-left font-medium">Effective Date</th>
                                                                <th className="px-4 py-2 text-left font-medium">Old → New CTC</th>
                                                                <th className="px-4 py-2 text-left font-medium">Source</th>
                                                                <th className="px-4 py-2 text-left font-medium">Changed By</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {ctcHistory.map((h) => (
                                                                <tr key={h.id} className="border-t border-gray-100 dark:border-sidebar-accent">
                                                                    <td className="px-4 py-2">{toDisplayDate(new Date(h.effectiveDate))}</td>
                                                                    <td className="px-4 py-2">
                                                                        {h.fromMonthlyCtc !== null ? formatCurrency(h.fromMonthlyCtc) : '—'} → {formatCurrency(h.toMonthlyCtc)}
                                                                    </td>
                                                                    <td className="px-4 py-2">{CTC_SOURCE_LABEL[h.source]}</td>
                                                                    <td className="px-4 py-2">{h.changedByName ?? '—'}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </div>

                                        <div className="space-y-3">
                                            <h3 className="text-sm font-semibold text-foreground dark:text-slate-100">Role (Designation) Change History</h3>
                                            <p className="text-xs text-slate-400">
                                                Only shows designation changes made via Promotion — a Designation edited directly on the Organization tab isn&apos;t logged here.
                                            </p>
                                            {roleHistory.length === 0 ? (
                                                <p className="text-sm text-slate-500 dark:text-slate-400">No approved promotions recorded yet.</p>
                                            ) : (
                                                <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-sidebar-accent">
                                                    <table className="w-full text-sm">
                                                        <thead className="bg-gray-50 dark:bg-sidebar-accent/40">
                                                            <tr>
                                                                <th className="px-4 py-2 text-left font-medium">Effective Date</th>
                                                                <th className="px-4 py-2 text-left font-medium">From → To Designation</th>
                                                                <th className="px-4 py-2 text-left font-medium">Approved By</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {roleHistory.map((r) => (
                                                                <tr key={r.id} className="border-t border-gray-100 dark:border-sidebar-accent">
                                                                    <td className="px-4 py-2">{toDisplayDate(new Date(r.effectiveDate))}</td>
                                                                    <td className="px-4 py-2">{r.fromDesignationName ?? '—'} → {r.toDesignationName}</td>
                                                                    <td className="px-4 py-2">{r.approvedByName ?? '—'}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </TabsContent>
                        </Tabs>
                    </CardContent>
                </Card>
            </div>

            {idCardDialogs}
        </div>
    );
}
