'use client';

import { useState, useMemo } from 'react';
import {
    Plus, Trash2, CheckCircle2, Circle, User, MapPin, IdCard,
    Landmark, ShieldCheck, Users2, Paperclip, AlertCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useHrOnboardingValidation } from '@/hooks/useHrOnboardingValidation';
import {
    GENDER_OPTIONS, MARITAL_STATUS_OPTIONS, CONFIGURABLE_ONBOARDING_FIELD_KEYS, getInapplicableSpouseKeys,
    CHILD_FIELD_CONFIG_KEYS, type ChildFieldName,
} from '@/app/lib/hr/onboarding-form-fields';
import { groupErrorsBySection, validateSingleField } from '@/app/lib/hr/onboarding-validation-rules';
import { DateInput } from '@/components/ui/date-input';

// ─── Types ──────────────────────────────────────────────────────
export interface ChildEntry {
    gender: string;
    age: string;
    aadhaarNumber: string;
}

export interface OnboardingFormValues {
    employeeName: string;
    branchId: string;
    /** Chosen when the request is raised (OnboardingOrgPicker); Region/Division are recorded on the request, Shift is applied to the employee at final approval. */
    regionId: string;
    divisionId: string;
    shiftId: string;
    designationId: string;
    departmentId: string;
    educationQualification: string;
    mobileNumber: string;
    email: string;
    currentAddress: string;
    permanentAddress: string;
    dateOfBirth: string; // yyyy-mm-dd
    gender: string;
    maritalStatus: string;
    emergencyContactName: string;
    emergencyContactRelation: string;
    emergencyContactNumber: string;
    bloodGroup: string;
    aadhaarNumber: string;
    panNumber: string;
    dlNumber: string;
    voterIdNumber: string;
    uanNumber: string;
    esiNumber: string;
    bankName: string;
    bankBranchName: string;
    accountNumber: string;
    ifscCode: string;
    reportingManagerId: string;
    dateOfJoining: string; // yyyy-mm-dd
    insuranceCompanyName: string;
    insurancePolicyNumber: string;
    insuranceValidFrom: string;
    insuranceValidTo: string;
    // ── Family Details ──
    fatherName: string;
    fatherAge: string;
    fatherAadhaarNumber: string;
    motherName: string;
    motherAge: string;
    motherAadhaarNumber: string;
    wifeName: string;
    wifeAge: string;
    wifeAadhaarNumber: string;
    wifeBankAccountNumber: string;
    wifeIfscCode: string;
    wifeContactNumber: string;
    husbandName: string;
    husbandAge: string;
    husbandAadhaarNumber: string;
    husbandBankAccountNumber: string;
    husbandIfscCode: string;
    husbandContactNumber: string;
    weddingDate: string; // yyyy-mm-dd
    children: ChildEntry[];
}

export function emptyOnboardingFormValues(): OnboardingFormValues {
    return {
        employeeName: '', branchId: '', regionId: '', divisionId: '', shiftId: '', designationId: '', departmentId: '',
        educationQualification: '', mobileNumber: '', email: '', currentAddress: '',
        permanentAddress: '', dateOfBirth: '', gender: '', maritalStatus: '',
        emergencyContactName: '', emergencyContactRelation: '', emergencyContactNumber: '', bloodGroup: '',
        aadhaarNumber: '', panNumber: '', dlNumber: '', voterIdNumber: '',
        uanNumber: '', esiNumber: '', bankName: '', bankBranchName: '', accountNumber: '', ifscCode: '',
        reportingManagerId: '', dateOfJoining: '', insuranceCompanyName: '',
        insurancePolicyNumber: '', insuranceValidFrom: '', insuranceValidTo: '',
        fatherName: '', fatherAge: '', fatherAadhaarNumber: '',
        motherName: '', motherAge: '', motherAadhaarNumber: '',
        wifeName: '', wifeAge: '', wifeAadhaarNumber: '',
        wifeBankAccountNumber: '', wifeIfscCode: '', wifeContactNumber: '',
        husbandName: '', husbandAge: '', husbandAadhaarNumber: '',
        husbandBankAccountNumber: '', husbandIfscCode: '', husbandContactNumber: '',
        weddingDate: '', children: [],
    };
}

function toNullableInt(value: string): number | null {
    const trimmed = value.trim();
    return trimmed === '' ? null : Number(trimmed);
}

/**
 * Converts the form's all-strings state into the shape the API expects —
 * empty numeric fields become `null` (not "" fed into a number coercion,
 * which would fail validation), and child rows with no gender/age typed in
 * at all are dropped rather than submitted as empty records.
 */
export function toOnboardingApiPayload(values: OnboardingFormValues) {
    const hideSpouseFields = values.maritalStatus !== 'MARRIED';
    const inapplicable = getInapplicableSpouseKeys(values.maritalStatus, values.gender);

    // Blank → null, not ''. The server's shared schema turns '' into
    // `undefined`, which Prisma reads as "leave unchanged" — so erasing a value
    // and saving a draft never actually cleared it. null clears it, exactly as
    // the age fields below already do. Spouse fields hidden by the current
    // marital status/gender are nulled the same way, so a stale value can't
    // linger after the applicant switches (Employee Master does the same on
    // save). The organization keys (branch/designation/department/manager/
    // date of joining) aren't collected here and are deliberately left ''
    // ("leave unchanged") so this form can never clobber them.
    const cleaned: Record<string, unknown> = { ...values };
    for (const key of CONFIGURABLE_ONBOARDING_FIELD_KEYS) {
        const value = values[key];
        cleaned[key] = inapplicable.includes(key) || (typeof value === 'string' && value.trim() === '') ? null : value;
    }

    const payload: Record<string, unknown> = {
        ...cleaned,
        fatherAge: toNullableInt(values.fatherAge),
        motherAge: toNullableInt(values.motherAge),
        wifeAge: inapplicable.includes('wifeAge') ? null : toNullableInt(values.wifeAge),
        husbandAge: inapplicable.includes('husbandAge') ? null : toNullableInt(values.husbandAge),
        children: hideSpouseFields
            ? []
            : values.children
                .filter((c) => c.gender.trim() !== '' || c.age.trim() !== '' || c.aadhaarNumber.trim() !== '')
                .map((c) => ({
                    gender: c.gender || null,
                    age: toNullableInt(c.age),
                    aadhaarNumber: c.aadhaarNumber || null,
                })),
    };
    return payload;
}

export interface LookupOption { id: string; label: string }

// Kept exported for OnboardingQueueClient, which still needs branch/
// designation/department/manager option lists for its own submit-time branch
// picker and final-approval panel — this form no longer consumes any of it.
export interface OnboardingFormLookups {
    branches: LookupOption[];
    departments: LookupOption[];
    designations: LookupOption[];
    managers: LookupOption[];
}

interface Props {
    values: OnboardingFormValues;
    onChange: (field: keyof OnboardingFormValues, value: string) => void;
    onChildrenChange: (children: ChildEntry[]) => void;
    disabled?: boolean;
    /** Controlled active-tab pair — pass both to drive navigation (e.g. a
     * Previous/Next footer) from the parent; omit either to let the form
     * manage its own tab state internally (the public onboarding page does this). */
    activeSection?: SectionId;
    onSectionChange?: (section: SectionId) => void;
    /** Renders inside the 'documents' tab. Upload mechanics differ between
     * callers (authenticated apiClient vs. the public page's plain fetch),
     * so this form stays agnostic — it just hosts whatever slot it's given. */
    documentsSlot?: React.ReactNode;
    errors?: Record<string, string>;
    onBlurField?: (field: keyof OnboardingFormValues) => void;
    /** Overrides the admin-configured required-check (useHrOnboardingValidation)
     * for callers that can't make that authenticated fetch — namely the public
     * joinee link, which has no session. Manual Entry omits this and gets the
     * hook's own live config, same as always. */
    isFieldRequiredOverride?: (fieldKey: string) => boolean;
}

// ─── Sections (tabs) — mirrors the Member Enrollment page's tab pattern ──
// No 'organization' section — Branch is now picked by the admin at Submit for
// Approval time (OnboardingQueueClient), and Designation/Department/Reporting
// Manager/Date of Joining are collected at final approval (the "Finalize
// Employee Details" panel), so none of that data is gathered on this form.
export type SectionId = 'personal' | 'address' | 'identity' | 'bank' | 'insurance' | 'family' | 'documents';

export const SECTIONS: { id: SectionId; label: string; icon: LucideIcon }[] = [
    { id: 'personal', label: 'Personal Details', icon: User },
    { id: 'address', label: 'Address', icon: MapPin },
    { id: 'identity', label: 'Identity & Statutory', icon: IdCard },
    { id: 'bank', label: 'Bank Details', icon: Landmark },
    { id: 'insurance', label: 'Vehicle Insurance', icon: ShieldCheck },
    { id: 'family', label: 'Family Details', icon: Users2 },
    { id: 'documents', label: 'Documents', icon: Paperclip },
];

// Which fields live in each section, for the tab-bar completion indicator —
// a section is "complete" once every field the admin has currently marked
// required (via the Onboarding Field Validation admin page) is filled in.
// 'documents' has no form fields of its own (no required/optional concept —
// it always shows as complete), so it's an empty list.
const SECTION_FIELDS: Record<SectionId, (keyof OnboardingFormValues)[]> = {
    personal: ['employeeName', 'mobileNumber', 'email', 'dateOfBirth', 'gender', 'maritalStatus', 'bloodGroup', 'educationQualification'],
    address: ['currentAddress', 'permanentAddress', 'emergencyContactName', 'emergencyContactRelation', 'emergencyContactNumber'],
    identity: ['aadhaarNumber', 'panNumber', 'dlNumber', 'voterIdNumber', 'uanNumber', 'esiNumber'],
    bank: ['bankName', 'bankBranchName', 'accountNumber', 'ifscCode'],
    insurance: ['insuranceCompanyName', 'insurancePolicyNumber', 'insuranceValidFrom', 'insuranceValidTo'],
    family: ['fatherName', 'fatherAge', 'fatherAadhaarNumber', 'motherName', 'motherAge', 'motherAadhaarNumber',
        'wifeName', 'wifeAge', 'wifeAadhaarNumber', 'wifeBankAccountNumber', 'wifeIfscCode', 'wifeContactNumber',
        'husbandName', 'husbandAge', 'husbandAadhaarNumber', 'husbandBankAccountNumber', 'husbandIfscCode', 'husbandContactNumber',
        'weddingDate'],
    documents: [],
};

// ─── Field primitives (module-level — never recreated on re-render) ──────
interface TextFieldProps {
    id?: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    onBlur?: () => void;
    required?: boolean;
    type?: string;
    disabled?: boolean;
    error?: string;
    maxLength?: number;
    digitsOnly?: boolean;
    uppercase?: boolean;
    placeholder?: string;
}
function TextField({
    id, label, value, onChange, onBlur, required, type = 'text', disabled,
    error, maxLength, digitsOnly, uppercase, placeholder,
}: TextFieldProps) {
    const fieldId = id || label.toLowerCase().replace(/[^a-z0-9]/g, '');
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let val = e.target.value;
        if (digitsOnly) {
            val = val.replace(/\D/g, '');
        }
        if (uppercase) {
            val = val.toUpperCase();
        }
        if (maxLength && val.length > maxLength) {
            val = val.slice(0, maxLength);
        }
        onChange(val);
    };

    return (
        <div>
            <Label htmlFor={fieldId} className="mb-1.5 block text-xs text-gray-500">
                {label}{required && <span className="text-red-500 font-bold ml-0.5">*</span>}
            </Label>
            {type === 'date' ? (
                <DateInput
                    id={fieldId}
                    value={value}
                    onChange={handleChange}
                    onBlur={onBlur}
                    disabled={disabled}
                    className={error ? 'border-red-500 focus-visible:ring-red-500' : ''}
                />
            ) : (
                <Input
                    id={fieldId}
                    type={type}
                    value={value}
                    onChange={handleChange}
                    onBlur={onBlur}
                    maxLength={maxLength}
                    placeholder={placeholder}
                    disabled={disabled}
                    className={error ? 'border-red-500 focus-visible:ring-red-500' : ''}
                />
            )}
            {error && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-red-600 font-normal">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                    <span>{error}</span>
                </p>
            )}
        </div>
    );
}

interface PickerFieldProps {
    id?: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: LookupOption[];
    required?: boolean;
    disabled?: boolean;
    error?: string;
}
function PickerField({ id, label, value, onChange, options, required, disabled, error }: PickerFieldProps) {
    const fieldId = id || label.toLowerCase().replace(/[^a-z0-9]/g, '');
    return (
        <div>
            <Label htmlFor={fieldId} className="mb-1.5 block text-xs text-gray-500">
                {label}{required && <span className="text-red-500 font-bold ml-0.5">*</span>}
            </Label>
            <Select value={value} onValueChange={onChange} disabled={disabled}>
                <SelectTrigger id={fieldId} className={error ? 'border-red-500 focus-visible:ring-red-500' : ''}>
                    <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
                </SelectTrigger>
                <SelectContent>
                    {options.map((o) => (
                        <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {error && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-red-600 font-normal">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                    <span>{error}</span>
                </p>
            )}
        </div>
    );
}

function isFieldFilled(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    return Boolean(value);
}

// Renders the same "Employee Profile Details" field set on both the
// authenticated manual-entry form (OnboardingQueueClient) and the public,
// unauthenticated joinee-facing page (app/apply/onboarding/[token]) — one
// definition of the form, two entry points into the same pipeline.
//
// Sectioned into tabs (like ClientEnrollmentForm's Member Details / Other
// Details / ... tab bar) instead of one long scroll; which fields carry the
// red asterisk comes from useHrOnboardingValidation (admin-configurable via
// /dashboard/admin/hr-onboarding-field-config), not a hardcoded prop.
export function OnboardingRequestForm({
    values, onChange, onChildrenChange, disabled,
    activeSection: controlledSection, onSectionChange, documentsSlot,
    errors, onBlurField, isFieldRequiredOverride,
}: Props) {
    const [internalSection, setInternalSection] = useState<SectionId>('personal');
    const activeSection = controlledSection ?? internalSection;
    const setActiveSection = onSectionChange ?? setInternalSection;
    // The public joinee page has no session to fetch this with, so it supplies
    // isFieldRequiredOverride (built from the field config its own unauthenticated
    // GET already returns) instead — see the Props doc comment above.
    const { isRequired: hookIsRequired } = useHrOnboardingValidation();
    const isRequired = isFieldRequiredOverride ?? hookIsRequired;

    const set = (field: keyof OnboardingFormValues) => (value: string) => onChange(field, value);
    const req = (field: keyof OnboardingFormValues) => isRequired(field);
    const err = (field: keyof OnboardingFormValues | string) => errors?.[field];
    const blur = (field: keyof OnboardingFormValues) => () => onBlurField?.(field);

    // Only currently married applicants show spouse fields, Wedding Date, and Children.
    // Single, Divorced, Widowed, or unselected all hide spouse/children fields.
    const hideSpouseFields = values.maritalStatus !== 'MARRIED';
    const isMale = values.gender === 'MALE';
    const isFemale = values.gender === 'FEMALE';
    const showWifeFields = !hideSpouseFields && isMale;
    const showHusbandFields = !hideSpouseFields && isFemale;

    const errorGroups = useMemo(() => {
        if (!errors || Object.keys(errors).length === 0) return [];
        return groupErrorsBySection(errors);
    }, [errors]);

    const totalErrorCount = useMemo(() => {
        return errorGroups.reduce((acc, g) => acc + g.errors.length, 0);
    }, [errorGroups]);

    const getSectionErrorCount = (id: SectionId): number => {
        if (!errors || Object.keys(errors).length === 0) return 0;
        if (id === 'family') {
            const familyErrors = SECTION_FIELDS.family.filter((f) => Boolean(errors[f])).length;
            const childErrors = Object.keys(errors).filter((k) => k.startsWith('children.') && Boolean(errors[k])).length;
            return familyErrors + childErrors;
        }
        return SECTION_FIELDS[id].filter((f) => Boolean(errors[f])).length;
    };

    const sectionHasErrors = (id: SectionId): boolean => {
        return getSectionErrorCount(id) > 0;
    };

    const handleNavigateToField = (sectionId: SectionId, fieldKey: string) => {
        setActiveSection(sectionId);
        setTimeout(() => {
            const el = document.getElementById(fieldKey);
            if (el) {
                el.focus();
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    };

    const sectionComplete = (id: SectionId): boolean => {
        if (id === 'personal') {
            const requiredFields = SECTION_FIELDS.personal.filter(
                (f) => req(f) || ['employeeName', 'mobileNumber', 'dateOfBirth', 'gender'].includes(f)
            );
            if (sectionHasErrors('personal')) return false;

            const allRequiredValid = requiredFields.every((field) => {
                const val = values[field];
                if (!isFieldFilled(val)) return false;
                return validateSingleField(field, val, values, true) === null;
            });
            if (!allRequiredValid) return false;

            const optionalFields = SECTION_FIELDS.personal.filter((f) => !requiredFields.includes(f));
            const allOptionalValid = optionalFields.every((field) => {
                const val = values[field];
                if (!isFieldFilled(val)) return true;
                return validateSingleField(field, val, values, false) === null;
            });
            return allOptionalValid;
        }

        if (id === 'address') {
            const requiredFields = SECTION_FIELDS.address.filter(
                (f) => req(f) || ['currentAddress', 'permanentAddress'].includes(f)
            );
            if (sectionHasErrors('address')) return false;

            const allRequiredValid = requiredFields.every((field) => {
                const val = values[field];
                if (!isFieldFilled(val)) return false;
                return validateSingleField(field, val, values, true) === null;
            });
            if (!allRequiredValid) return false;

            const optionalFields = SECTION_FIELDS.address.filter((f) => !requiredFields.includes(f));
            const allOptionalValid = optionalFields.every((field) => {
                const val = values[field];
                if (!isFieldFilled(val)) return true;
                return validateSingleField(field, val, values, false) === null;
            });
            return allOptionalValid;
        }

        if (id !== 'family') {
            return SECTION_FIELDS[id].every((field) => !req(field) || isFieldFilled(values[field] as string));
        }
        const notShown = getInapplicableSpouseKeys(values.maritalStatus, values.gender);
        const fields = SECTION_FIELDS.family.filter((field) => !notShown.includes(field));
        const childrenComplete = values.maritalStatus !== 'MARRIED' || values.children.every((child) =>
            (Object.keys(CHILD_FIELD_CONFIG_KEYS) as ChildFieldName[]).every((f) => !isRequired(CHILD_FIELD_CONFIG_KEYS[f]) || isFieldFilled(child[f])));
        return childrenComplete && fields.every((field) => !req(field) || isFieldFilled(values[field] as string));
    };

    const updateChild = (index: number, patch: Partial<ChildEntry>) => {
        onChildrenChange(values.children.map((c, i) => (i === index ? { ...c, ...patch } : c)));
    };
    const addChild = () => onChildrenChange([...values.children, { gender: '', age: '', aadhaarNumber: '' }]);
    const removeChild = (index: number) => onChildrenChange(values.children.filter((_, i) => i !== index));

    return (
        <div className="space-y-4">
            {/* ── Submission Error Summary Banner ── */}
            {totalErrorCount > 0 && (
                <div
                    id="onboarding-validation-summary"
                    role="alert"
                    aria-live="polite"
                    className="rounded-lg border border-red-200 bg-red-50/70 p-4 text-slate-800"
                >
                    <div className="flex items-start gap-3">
                        <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                        <div className="space-y-3 flex-1">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900">
                                    Please fix {totalErrorCount} {totalErrorCount === 1 ? 'error' : 'errors'} before continuing.
                                </h3>
                                <p className="text-xs text-slate-600 mt-0.5">
                                    Click any item below to navigate directly to the field and correct the value.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                                {errorGroups.map((group) => (
                                    <div
                                        key={group.sectionId}
                                        className="rounded-md border border-red-100 bg-white/80 p-3"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => setActiveSection(group.sectionId)}
                                            className="text-xs font-semibold text-slate-900 hover:text-red-700 transition-colors flex items-center gap-1.5 mb-1.5 cursor-pointer"
                                        >
                                            <span>{group.sectionLabel}</span>
                                            <span className="inline-flex items-center justify-center px-1.5 py-0.2 text-[10px] font-medium leading-none text-red-700 bg-red-100 rounded border border-red-200">
                                                {group.errors.length}
                                            </span>
                                        </button>
                                        <ul className="space-y-1 text-xs text-slate-600">
                                            {group.errors.map((errItem) => (
                                                <li key={errItem.fieldKey}>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleNavigateToField(group.sectionId, errItem.fieldKey)}
                                                        className="text-left text-xs text-slate-700 hover:text-red-700 hover:underline flex items-baseline gap-1.5 cursor-pointer transition-colors"
                                                    >
                                                        <span className="text-slate-400 font-normal shrink-0">•</span>
                                                        <span className="font-medium text-slate-900 shrink-0">{errItem.fieldLabel} —</span>
                                                        <span className="text-red-600">{errItem.message}</span>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Tab bar ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5">
                {SECTIONS.map((section) => {
                    const Icon = section.icon;
                    const complete = sectionComplete(section.id);
                    const hasErr = sectionHasErrors(section.id);
                    const errCount = getSectionErrorCount(section.id);
                    const active = activeSection === section.id;
                    return (
                        <button
                            key={section.id}
                            type="button"
                            onClick={() => setActiveSection(section.id)}
                            className={`flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs transition-colors cursor-pointer ${
                                active
                                    ? hasErr
                                        ? 'border-red-500 bg-red-50/80 text-red-700 font-semibold ring-1 ring-red-500'
                                        : 'border-primary bg-primary/10 text-primary font-semibold'
                                    : hasErr
                                    ? 'border-red-200 bg-red-50/40 text-red-700 hover:border-red-300 hover:bg-red-50/70'
                                    : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50/50'
                            }`}
                        >
                            <div className="flex items-center gap-1.5">
                                <Icon className="h-3.5 w-3.5 shrink-0" />
                                {hasErr ? (
                                    <div className="flex items-center gap-1">
                                        <AlertCircle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                                        <span
                                            className="inline-flex items-center justify-center px-1.5 py-0.2 text-[10px] font-medium leading-none text-red-700 bg-red-100 rounded border border-red-200"
                                            title={`${errCount} error${errCount > 1 ? 's' : ''}`}
                                        >
                                            {errCount}
                                        </span>
                                    </div>
                                ) : complete ? (
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                ) : (
                                    <Circle className="h-3 w-3 text-slate-300 shrink-0" />
                                )}
                            </div>
                            <span className="text-center leading-tight">
                                {section.label}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* ── Active section ── */}
            {activeSection === 'personal' && (
                <Card>
                    <CardHeader><CardTitle className="text-sm">Personal Details</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <TextField
                            id="employeeName"
                            label="Employee Name"
                            value={values.employeeName}
                            onChange={set('employeeName')}
                            onBlur={blur('employeeName')}
                            required={req('employeeName')}
                            error={err('employeeName')}
                            disabled={disabled}
                        />
                        <TextField
                            id="mobileNumber"
                            label="Mobile Number"
                            value={values.mobileNumber}
                            onChange={set('mobileNumber')}
                            onBlur={blur('mobileNumber')}
                            required={req('mobileNumber')}
                            error={err('mobileNumber')}
                            maxLength={10}
                            digitsOnly={true}
                            placeholder="10-digit mobile number"
                            disabled={disabled}
                        />
                        <TextField
                            id="email"
                            label="Email ID"
                            value={values.email}
                            onChange={set('email')}
                            onBlur={blur('email')}
                            type="email"
                            required={req('email')}
                            error={err('email')}
                            placeholder="name@example.com"
                            disabled={disabled}
                        />
                        <TextField
                            id="dateOfBirth"
                            label="Date of Birth"
                            value={values.dateOfBirth}
                            onChange={set('dateOfBirth')}
                            onBlur={blur('dateOfBirth')}
                            type="date"
                            required={req('dateOfBirth')}
                            error={err('dateOfBirth')}
                            disabled={disabled}
                        />
                        <PickerField
                            id="gender"
                            label="Gender"
                            value={values.gender}
                            onChange={set('gender')}
                            required={req('gender')}
                            error={err('gender')}
                            disabled={disabled}
                            options={GENDER_OPTIONS}
                        />
                        <PickerField
                            id="maritalStatus"
                            label="Marital Status"
                            value={values.maritalStatus}
                            onChange={set('maritalStatus')}
                            required={req('maritalStatus')}
                            error={err('maritalStatus')}
                            disabled={disabled}
                            options={MARITAL_STATUS_OPTIONS}
                        />
                        <TextField
                            id="bloodGroup"
                            label="Blood Group"
                            value={values.bloodGroup}
                            onChange={set('bloodGroup')}
                            onBlur={blur('bloodGroup')}
                            required={req('bloodGroup')}
                            error={err('bloodGroup')}
                            uppercase={true}
                            maxLength={5}
                            placeholder="e.g. O+"
                            disabled={disabled}
                        />
                        <TextField
                            id="educationQualification"
                            label="Education Qualification"
                            value={values.educationQualification}
                            onChange={set('educationQualification')}
                            onBlur={blur('educationQualification')}
                            required={req('educationQualification')}
                            error={err('educationQualification')}
                            placeholder="e.g. B.Com"
                            disabled={disabled}
                        />
                    </CardContent>
                </Card>
            )}

            {activeSection === 'address' && (
                <Card>
                    <CardHeader><CardTitle className="text-sm">Address</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <TextField
                            id="currentAddress"
                            label="Current Address"
                            value={values.currentAddress}
                            onChange={set('currentAddress')}
                            onBlur={blur('currentAddress')}
                            required={req('currentAddress')}
                            error={err('currentAddress')}
                            disabled={disabled}
                        />
                        <TextField
                            id="permanentAddress"
                            label="Permanent Address"
                            value={values.permanentAddress}
                            onChange={set('permanentAddress')}
                            onBlur={blur('permanentAddress')}
                            required={req('permanentAddress')}
                            error={err('permanentAddress')}
                            disabled={disabled}
                        />
                        <TextField
                            id="emergencyContactName"
                            label="Emergency Contact Name"
                            value={values.emergencyContactName}
                            onChange={set('emergencyContactName')}
                            onBlur={blur('emergencyContactName')}
                            required={req('emergencyContactName')}
                            error={err('emergencyContactName')}
                            disabled={disabled}
                        />
                        <TextField
                            id="emergencyContactRelation"
                            label="Emergency Contact Relationship"
                            value={values.emergencyContactRelation}
                            onChange={set('emergencyContactRelation')}
                            onBlur={blur('emergencyContactRelation')}
                            required={req('emergencyContactRelation')}
                            error={err('emergencyContactRelation')}
                            placeholder="e.g. Father, Mother, Spouse, Friend"
                            disabled={disabled}
                        />
                        <TextField
                            id="emergencyContactNumber"
                            label="Emergency Contact Number"
                            value={values.emergencyContactNumber}
                            onChange={set('emergencyContactNumber')}
                            onBlur={blur('emergencyContactNumber')}
                            required={req('emergencyContactNumber')}
                            error={err('emergencyContactNumber')}
                            maxLength={10}
                            digitsOnly={true}
                            placeholder="10-digit mobile number"
                            disabled={disabled}
                        />
                    </CardContent>
                </Card>
            )}

            {activeSection === 'identity' && (
                <Card>
                    <CardHeader><CardTitle className="text-sm">Identity &amp; Statutory Details</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <TextField
                            id="aadhaarNumber"
                            label="Aadhaar Number"
                            value={values.aadhaarNumber}
                            onChange={set('aadhaarNumber')}
                            onBlur={blur('aadhaarNumber')}
                            required={req('aadhaarNumber')}
                            error={err('aadhaarNumber')}
                            maxLength={12}
                            digitsOnly={true}
                            placeholder="12-digit Aadhaar number"
                            disabled={disabled}
                        />
                        <TextField
                            id="panNumber"
                            label="PAN Number"
                            value={values.panNumber}
                            onChange={set('panNumber')}
                            onBlur={blur('panNumber')}
                            required={req('panNumber')}
                            error={err('panNumber')}
                            maxLength={10}
                            uppercase={true}
                            placeholder="ABCDE1234F"
                            disabled={disabled}
                        />
                        <TextField
                            id="dlNumber"
                            label="DL &amp; LLR Number"
                            value={values.dlNumber}
                            onChange={set('dlNumber')}
                            onBlur={blur('dlNumber')}
                            required={req('dlNumber')}
                            error={err('dlNumber')}
                            placeholder="e.g. TN38 20190001234"
                            uppercase={true}
                            disabled={disabled}
                        />
                        <TextField
                            id="voterIdNumber"
                            label="Voter ID Number"
                            value={values.voterIdNumber}
                            onChange={set('voterIdNumber')}
                            onBlur={blur('voterIdNumber')}
                            required={req('voterIdNumber')}
                            error={err('voterIdNumber')}
                            placeholder="e.g. ABC1234567"
                            uppercase={true}
                            disabled={disabled}
                        />
                        <TextField
                            id="uanNumber"
                            label="UAN Number"
                            value={values.uanNumber}
                            onChange={set('uanNumber')}
                            onBlur={blur('uanNumber')}
                            required={req('uanNumber')}
                            error={err('uanNumber')}
                            maxLength={12}
                            digitsOnly={true}
                            placeholder="12-digit UAN"
                            disabled={disabled}
                        />
                        <TextField
                            id="esiNumber"
                            label="ESI Number"
                            value={values.esiNumber}
                            onChange={set('esiNumber')}
                            onBlur={blur('esiNumber')}
                            required={req('esiNumber')}
                            error={err('esiNumber')}
                            maxLength={17}
                            digitsOnly={true}
                            placeholder="17-digit ESI"
                            disabled={disabled}
                        />
                    </CardContent>
                </Card>
            )}

            {activeSection === 'bank' && (
                <Card>
                    <CardHeader><CardTitle className="text-sm">Bank Details</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <TextField
                            id="bankName"
                            label="Bank Name"
                            value={values.bankName}
                            onChange={set('bankName')}
                            onBlur={blur('bankName')}
                            required={req('bankName')}
                            error={err('bankName')}
                            disabled={disabled}
                        />
                        <TextField
                            id="bankBranchName"
                            label="Bank Branch Name"
                            value={values.bankBranchName}
                            onChange={set('bankBranchName')}
                            onBlur={blur('bankBranchName')}
                            required={req('bankBranchName')}
                            error={err('bankBranchName')}
                            placeholder="e.g. Main Branch"
                            disabled={disabled}
                        />
                        <TextField
                            id="accountNumber"
                            label="Account Number"
                            value={values.accountNumber}
                            onChange={set('accountNumber')}
                            onBlur={blur('accountNumber')}
                            required={req('accountNumber')}
                            error={err('accountNumber')}
                            maxLength={18}
                            digitsOnly={true}
                            placeholder="9 to 18 digits"
                            disabled={disabled}
                        />
                        <TextField
                            id="ifscCode"
                            label="IFSC Code"
                            value={values.ifscCode}
                            onChange={set('ifscCode')}
                            onBlur={blur('ifscCode')}
                            required={req('ifscCode')}
                            error={err('ifscCode')}
                            maxLength={11}
                            uppercase={true}
                            placeholder="SBIN0001234"
                            disabled={disabled}
                        />
                    </CardContent>
                </Card>
            )}

            {activeSection === 'insurance' && (
                <Card>
                    <CardHeader><CardTitle className="text-sm">Vehicle Insurance</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <TextField
                            id="insuranceCompanyName"
                            label="Insurance Company Name"
                            value={values.insuranceCompanyName}
                            onChange={set('insuranceCompanyName')}
                            onBlur={blur('insuranceCompanyName')}
                            required={req('insuranceCompanyName')}
                            error={err('insuranceCompanyName')}
                            placeholder="e.g. HDFC Ergo"
                            disabled={disabled}
                        />
                        <TextField
                            id="insurancePolicyNumber"
                            label="Insurance Policy Number"
                            value={values.insurancePolicyNumber}
                            onChange={set('insurancePolicyNumber')}
                            onBlur={blur('insurancePolicyNumber')}
                            required={req('insurancePolicyNumber')}
                            error={err('insurancePolicyNumber')}
                            placeholder="e.g. POL12345678"
                            disabled={disabled}
                        />
                        <TextField
                            id="insuranceValidFrom"
                            label="Valid From Date"
                            value={values.insuranceValidFrom}
                            onChange={set('insuranceValidFrom')}
                            onBlur={blur('insuranceValidFrom')}
                            type="date"
                            required={req('insuranceValidFrom')}
                            error={err('insuranceValidFrom')}
                            disabled={disabled}
                        />
                        <TextField
                            id="insuranceValidTo"
                            label="Valid To Date"
                            value={values.insuranceValidTo}
                            onChange={set('insuranceValidTo')}
                            onBlur={blur('insuranceValidTo')}
                            type="date"
                            required={req('insuranceValidTo')}
                            error={err('insuranceValidTo')}
                            disabled={disabled}
                        />
                    </CardContent>
                </Card>
            )}

            {activeSection === 'family' && (
                <Card>
                    <CardHeader><CardTitle className="text-sm">Family Details</CardTitle></CardHeader>
                    <CardContent className="space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <TextField
                                id="fatherName"
                                label="Father Name"
                                value={values.fatherName}
                                onChange={set('fatherName')}
                                onBlur={blur('fatherName')}
                                required={req('fatherName')}
                                error={err('fatherName')}
                                disabled={disabled}
                            />
                            <TextField
                                id="fatherAge"
                                label="Father Age"
                                value={values.fatherAge}
                                onChange={set('fatherAge')}
                                onBlur={blur('fatherAge')}
                                type="number"
                                required={req('fatherAge')}
                                error={err('fatherAge')}
                                disabled={disabled}
                            />
                            <TextField
                                id="fatherAadhaarNumber"
                                label="Father Aadhaar Number"
                                value={values.fatherAadhaarNumber}
                                onChange={set('fatherAadhaarNumber')}
                                onBlur={blur('fatherAadhaarNumber')}
                                required={req('fatherAadhaarNumber')}
                                error={err('fatherAadhaarNumber')}
                                maxLength={12}
                                digitsOnly={true}
                                placeholder="12-digit Aadhaar"
                                disabled={disabled}
                            />

                            <TextField
                                id="motherName"
                                label="Mother Name"
                                value={values.motherName}
                                onChange={set('motherName')}
                                onBlur={blur('motherName')}
                                required={req('motherName')}
                                error={err('motherName')}
                                disabled={disabled}
                            />
                            <TextField
                                id="motherAge"
                                label="Mother Age"
                                value={values.motherAge}
                                onChange={set('motherAge')}
                                onBlur={blur('motherAge')}
                                type="number"
                                required={req('motherAge')}
                                error={err('motherAge')}
                                disabled={disabled}
                            />
                            <TextField
                                id="motherAadhaarNumber"
                                label="Mother Aadhaar Number"
                                value={values.motherAadhaarNumber}
                                onChange={set('motherAadhaarNumber')}
                                onBlur={blur('motherAadhaarNumber')}
                                required={req('motherAadhaarNumber')}
                                error={err('motherAadhaarNumber')}
                                maxLength={12}
                                digitsOnly={true}
                                placeholder="12-digit Aadhaar"
                                disabled={disabled}
                            />
                        </div>

                        {showWifeFields && (
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <TextField
                                        id="wifeName"
                                        label="Spouse Name"
                                        value={values.wifeName}
                                        onChange={set('wifeName')}
                                        onBlur={blur('wifeName')}
                                        required={req('wifeName')}
                                        error={err('wifeName')}
                                        disabled={disabled}
                                    />
                                    <TextField
                                        id="wifeAge"
                                        label="Spouse Age"
                                        value={values.wifeAge}
                                        onChange={set('wifeAge')}
                                        onBlur={blur('wifeAge')}
                                        type="number"
                                        required={req('wifeAge')}
                                        error={err('wifeAge')}
                                        disabled={disabled}
                                    />
                                    <TextField
                                        id="wifeAadhaarNumber"
                                        label="Spouse Aadhaar Number"
                                        value={values.wifeAadhaarNumber}
                                        onChange={set('wifeAadhaarNumber')}
                                        onBlur={blur('wifeAadhaarNumber')}
                                        required={req('wifeAadhaarNumber')}
                                        error={err('wifeAadhaarNumber')}
                                        maxLength={12}
                                        digitsOnly={true}
                                        placeholder="12-digit Aadhaar"
                                        disabled={disabled}
                                    />
                                    <TextField
                                        id="wifeBankAccountNumber"
                                        label="Spouse Bank Account Number"
                                        value={values.wifeBankAccountNumber}
                                        onChange={set('wifeBankAccountNumber')}
                                        onBlur={blur('wifeBankAccountNumber')}
                                        required={req('wifeBankAccountNumber')}
                                        error={err('wifeBankAccountNumber')}
                                        maxLength={18}
                                        digitsOnly={true}
                                        placeholder="9 to 18 digits"
                                        disabled={disabled}
                                    />
                                    <TextField
                                        id="wifeIfscCode"
                                        label="Spouse IFSC Code"
                                        value={values.wifeIfscCode}
                                        onChange={set('wifeIfscCode')}
                                        onBlur={blur('wifeIfscCode')}
                                        required={req('wifeIfscCode')}
                                        error={err('wifeIfscCode')}
                                        maxLength={11}
                                        uppercase={true}
                                        placeholder="SBIN0001234"
                                        disabled={disabled}
                                    />
                                    <TextField
                                        id="wifeContactNumber"
                                        label="Spouse Contact Number"
                                        value={values.wifeContactNumber}
                                        onChange={set('wifeContactNumber')}
                                        onBlur={blur('wifeContactNumber')}
                                        required={req('wifeContactNumber')}
                                        error={err('wifeContactNumber')}
                                        maxLength={10}
                                        digitsOnly={true}
                                        placeholder="10-digit mobile number"
                                        disabled={disabled}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <TextField
                                        id="weddingDate"
                                        label="Wedding Date"
                                        value={values.weddingDate}
                                        onChange={set('weddingDate')}
                                        onBlur={blur('weddingDate')}
                                        type="date"
                                        required={req('weddingDate')}
                                        error={err('weddingDate')}
                                        disabled={disabled}
                                    />
                                </div>
                            </>
                        )}

                        {showHusbandFields && (
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <TextField
                                        id="husbandName"
                                        label="Spouse Name"
                                        value={values.husbandName}
                                        onChange={set('husbandName')}
                                        onBlur={blur('husbandName')}
                                        required={req('husbandName')}
                                        error={err('husbandName')}
                                        disabled={disabled}
                                    />
                                    <TextField
                                        id="husbandAge"
                                        label="Spouse Age"
                                        value={values.husbandAge}
                                        onChange={set('husbandAge')}
                                        onBlur={blur('husbandAge')}
                                        type="number"
                                        required={req('husbandAge')}
                                        error={err('husbandAge')}
                                        disabled={disabled}
                                    />
                                    <TextField
                                        id="husbandAadhaarNumber"
                                        label="Spouse Aadhaar Number"
                                        value={values.husbandAadhaarNumber}
                                        onChange={set('husbandAadhaarNumber')}
                                        onBlur={blur('husbandAadhaarNumber')}
                                        required={req('husbandAadhaarNumber')}
                                        error={err('husbandAadhaarNumber')}
                                        maxLength={12}
                                        digitsOnly={true}
                                        placeholder="12-digit Aadhaar"
                                        disabled={disabled}
                                    />
                                    <TextField
                                        id="husbandBankAccountNumber"
                                        label="Spouse Bank Account Number"
                                        value={values.husbandBankAccountNumber}
                                        onChange={set('husbandBankAccountNumber')}
                                        onBlur={blur('husbandBankAccountNumber')}
                                        required={req('husbandBankAccountNumber')}
                                        error={err('husbandBankAccountNumber')}
                                        maxLength={18}
                                        digitsOnly={true}
                                        placeholder="9 to 18 digits"
                                        disabled={disabled}
                                    />
                                    <TextField
                                        id="husbandIfscCode"
                                        label="Spouse IFSC Code"
                                        value={values.husbandIfscCode}
                                        onChange={set('husbandIfscCode')}
                                        onBlur={blur('husbandIfscCode')}
                                        required={req('husbandIfscCode')}
                                        error={err('husbandIfscCode')}
                                        maxLength={11}
                                        uppercase={true}
                                        placeholder="SBIN0001234"
                                        disabled={disabled}
                                    />
                                    <TextField
                                        id="husbandContactNumber"
                                        label="Spouse Contact Number"
                                        value={values.husbandContactNumber}
                                        onChange={set('husbandContactNumber')}
                                        onBlur={blur('husbandContactNumber')}
                                        required={req('husbandContactNumber')}
                                        error={err('husbandContactNumber')}
                                        maxLength={10}
                                        digitsOnly={true}
                                        placeholder="10-digit mobile number"
                                        disabled={disabled}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <TextField
                                        id="weddingDate"
                                        label="Wedding Date"
                                        value={values.weddingDate}
                                        onChange={set('weddingDate')}
                                        onBlur={blur('weddingDate')}
                                        type="date"
                                        required={req('weddingDate')}
                                        error={err('weddingDate')}
                                        disabled={disabled}
                                    />
                                </div>
                            </>
                        )}

                        {!hideSpouseFields && !showWifeFields && !showHusbandFields && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <TextField
                                    id="weddingDate"
                                    label="Wedding Date"
                                    value={values.weddingDate}
                                    onChange={set('weddingDate')}
                                    onBlur={blur('weddingDate')}
                                    type="date"
                                    required={req('weddingDate')}
                                    error={err('weddingDate')}
                                    disabled={disabled}
                                />
                            </div>
                        )}

                        {!hideSpouseFields && (
                            <div className="space-y-3">
                                <Label className="text-xs text-gray-500">Children</Label>
                                {values.children.map((child, index) => {
                                    const childGenderErr = err(`children.${index}.gender`);
                                    const childAgeErr = err(`children.${index}.age`);
                                    const childAadhaarErr = err(`children.${index}.aadhaarNumber`);
                                    const reqMark = (configKey: string) => isRequired(configKey) && <span className="text-red-500 font-bold ml-0.5">*</span>;
                                    const fieldErr = (message?: string) => message && (
                                        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-600 font-normal">
                                            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                                            <span>{message}</span>
                                        </p>
                                    );
                                    return (
                                        <div key={index} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end border rounded-lg p-3">
                                            <div>
                                                <Label className="mb-1.5 block text-xs text-gray-500">Gender{reqMark('childGender')}</Label>
                                                <Select value={child.gender} onValueChange={(v) => updateChild(index, { gender: v })} disabled={disabled}>
                                                    <SelectTrigger id={`children.${index}.gender`} className={childGenderErr ? 'border-red-500 focus:ring-red-500' : ''}><SelectValue placeholder="Select gender" /></SelectTrigger>
                                                    <SelectContent>
                                                        {GENDER_OPTIONS.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                                {fieldErr(childGenderErr)}
                                            </div>
                                            <div>
                                                <Label className="mb-1.5 block text-xs text-gray-500">Age{reqMark('childAge')}</Label>
                                                <Input
                                                    id={`children.${index}.age`}
                                                    type="number"
                                                    value={child.age}
                                                    onChange={(e) => updateChild(index, { age: e.target.value })}
                                                    disabled={disabled}
                                                    className={childAgeErr ? 'border-red-500 focus-visible:ring-red-500' : ''}
                                                />
                                                {fieldErr(childAgeErr)}
                                            </div>
                                            <div>
                                                <Label className="mb-1.5 block text-xs text-gray-500">Aadhaar Number{reqMark('childAadhaarNumber')}</Label>
                                                <Input
                                                    id={`children.${index}.aadhaarNumber`}
                                                    value={child.aadhaarNumber}
                                                    onChange={(e) => updateChild(index, { aadhaarNumber: e.target.value.replace(/\D/g, '').slice(0, 12) })}
                                                    disabled={disabled}
                                                    maxLength={12}
                                                    placeholder="12-digit Aadhaar"
                                                    className={childAadhaarErr ? 'border-red-500 focus-visible:ring-red-500' : ''}
                                                />
                                                {fieldErr(childAadhaarErr)}
                                            </div>
                                            <Button
                                                type="button" variant="ghost" size="icon"
                                                className="text-red-500 hover:text-red-700"
                                                onClick={() => removeChild(index)}
                                                disabled={disabled}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    );
                                })}
                                <Button type="button" variant="outline" size="sm" onClick={addChild} disabled={disabled} className="gap-1.5">
                                    <Plus className="h-3.5 w-3.5" /> Add Child
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {activeSection === 'documents' && (
                <Card>
                    <CardHeader><CardTitle className="text-sm">Documents</CardTitle></CardHeader>
                    <CardContent>{documentsSlot}</CardContent>
                </Card>
            )}
        </div>
    );
}
