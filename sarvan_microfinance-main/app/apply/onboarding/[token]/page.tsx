'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, AlertTriangle, Loader2, Building2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useBrandNames } from '@/app/lib/brand-context';
import {
    OnboardingRequestForm, emptyOnboardingFormValues, toOnboardingApiPayload, SECTIONS,
    type OnboardingFormValues, type ChildEntry, type SectionId,
} from '@/components/hr/OnboardingRequestForm';
import { OnboardingDocumentTile } from '@/components/hr/OnboardingDocumentTile';
import { validateOnboardingForm, validateSingleField, getSectionForField, clearChildAadhaarErrors } from '@/app/lib/hr/onboarding-validation-rules';

// One tile per document — KYC expanded into its 6 subtypes as individual
// tiles, matching the internal uploader (components/hr/OnboardingDocumentUploader.tsx)
// exactly except restricted to the categories a joinee can self-upload (the
// other 4 — JOINING_KIT, APPOINTMENT_LETTER, BGV_REPORT, ORIGINAL_CERTIFICATE_ACK
// — are things HR issues TO the employee). Mirrors the same allow-list
// enforced server-side in app/api/public/hr-onboarding/[token]/documents/route.ts.
const TILE_DEFS: { label: string; category: string; subtype: string | null }[] = [
    { label: 'Aadhaar', category: 'KYC', subtype: 'Aadhaar' },
    { label: 'PAN', category: 'KYC', subtype: 'PAN' },
    { label: 'DL / LLR', category: 'KYC', subtype: 'DL / LLR' },
    { label: 'Voter ID', category: 'KYC', subtype: 'Voter ID' },
    { label: 'UAN', category: 'KYC', subtype: 'UAN' },
    { label: 'Photo', category: 'KYC', subtype: 'Photo' },
    { label: 'Resume', category: 'RESUME', subtype: null },
    { label: 'Education Certificate', category: 'EDUCATION_CERTIFICATE', subtype: null },
    { label: 'Pre-Application Assessment', category: 'PRE_APPLICATION_ASSESSMENT', subtype: null },
    { label: 'Bank Passbook', category: 'BANK_PASSBOOK', subtype: null },
    { label: 'Relieving Letter / Payslip', category: 'RELIEVING_LETTER_PAYSLIP', subtype: null },
];

interface OnboardingDocRow {
    id: string;
    category: string;
    subtype: string | null;
    fileName: string;
    status: 'PENDING' | 'VERIFIED' | 'REJECTED';
}

// The joinee-facing counterpart to app/api/public/hr-onboarding/[token] — no
// login, reached only by the link an Admin generated for this specific hire.
// Plain fetch() here (not apiClient), deliberately: apiClient is built around
// an authenticated session (token refresh, branch headers) that doesn't exist
// on this page at all.
export default function PublicOnboardingPage() {
    const params = useParams();
    const token = params.token as string;
    const { toast } = useToast();
    const { companyNameFull } = useBrandNames();

    const [loading, setLoading] = useState(true);
    const [linkError, setLinkError] = useState<string | null>(null);
    const [values, setValues] = useState<OnboardingFormValues>(emptyOnboardingFormValues());
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    // Section-by-section, same as the internal Manual Entry tab
    // (OnboardingQueueClient.tsx) — Submit only ever appears on the last
    // section, so a joinee can no longer submit from "Personal" with every
    // other section (address, identity, bank, etc.) still empty.
    const [activeSection, setActiveSection] = useState<SectionId>('personal');

    const [documents, setDocuments] = useState<OnboardingDocRow[]>([]);
    // Which fields the admin currently marks Required (Onboarding Field
    // Validation) — fetched unauthenticated alongside the link's own validity,
    // since this page has no session to use the normal authenticated hook
    // (useHrOnboardingValidation) with. Populated from GET's `fieldConfig`.
    const [configRequired, setConfigRequired] = useState<Record<string, boolean>>({});

    // Only validates the token — branch/designation/department/reporting
    // manager are no longer collected here at all (branch is picked by the
    // admin at Submit for Approval, the rest at final approval), so the only
    // other thing from this response that reaches state is the documents list
    // (so a reload mid-fill doesn't look like already-uploaded files vanished).
    const loadLink = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/public/hr-onboarding/${token}`);
            const data = await res.json();
            if (!data.success) {
                setLinkError(data.error || 'This link is not valid.');
            } else {
                setDocuments(data.data.documents ?? []);
                const fieldConfig: { fieldKey: string; isRequired: boolean }[] = data.data.fieldConfig ?? [];
                setConfigRequired(Object.fromEntries(fieldConfig.map((c) => [c.fieldKey, c.isRequired])));
            }
        } catch {
            setLinkError('Could not reach the server. Please check your connection and try again.');
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => { loadLink(); }, [loadLink]);

    // Identity basics are always required for a joinee's own submission,
    // regardless of the admin's toggle (see submitSchema's own comment in
    // app/api/public/hr-onboarding/[token]/route.ts) — everything else follows
    // whatever the admin has configured, same as Manual Entry.
    const isPublicFieldRequired = useCallback(
        (fieldKey: string) =>
            ['employeeName', 'mobileNumber', 'dateOfBirth', 'gender'].includes(fieldKey) || !!configRequired[fieldKey],
        [configRequired]
    );

    const handleChange = (field: keyof OnboardingFormValues, value: string) => {
        setValues((prev) => ({ ...prev, [field]: value }));
        if (fieldErrors[field]) {
            setFieldErrors((prev) => {
                const next = { ...prev };
                delete next[field];
                return next;
            });
        }
    };

    const handleBlurField = (field: keyof OnboardingFormValues) => {
        const isReq = isPublicFieldRequired(field);
        const err = validateSingleField(field, values[field], values, isReq);
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
    const handleChildrenChange = (children: ChildEntry[]) => {
        const previousChildren = values.children;
        setValues((prev) => ({ ...prev, children }));
        setFieldErrors((prev) => clearChildAadhaarErrors(prev, previousChildren, children));
    };

    const findExisting = (category: string, subtype: string | null) =>
        documents.find((d) => d.category === category && d.subtype === subtype) ?? null;

    const uploadTo = async (category: string, subtype: string | null, file: File) => {
        try {
            const existing = findExisting(category, subtype);
            if (existing) {
                await fetch(`/api/public/hr-onboarding/${token}/documents/${existing.id}`, { method: 'DELETE' });
            }

            const formData = new FormData();
            formData.append('file', file);
            formData.append('category', category);
            if (subtype) formData.append('subtype', subtype);

            const res = await fetch(`/api/public/hr-onboarding/${token}/documents`, { method: 'POST', body: formData });
            const data = await res.json();
            if (data.success) {
                setDocuments((prev) => [data.data, ...prev.filter((d) => d.id !== existing?.id)]);
                toast({ title: 'Document uploaded' });
            } else {
                toast({ title: data.error || 'Upload failed', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Network error — please try again', variant: 'destructive' });
        }
    };

    const deleteDoc = async (docId: string) => {
        try {
            const res = await fetch(`/api/public/hr-onboarding/${token}/documents/${docId}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                setDocuments((prev) => prev.filter((d) => d.id !== docId));
            } else {
                toast({ title: data.error || 'Failed to remove document', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Network error — please try again', variant: 'destructive' });
        }
    };

    const handleSubmit = async () => {
        const validationErrors = validateOnboardingForm(values, isPublicFieldRequired, true);
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

        setSubmitting(true);
        try {
            const res = await fetch(`/api/public/hr-onboarding/${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(toOnboardingApiPayload(values)),
            });
            const data = await res.json();
            if (data.success) {
                setFieldErrors({});
                setSubmitted(true);
            } else {
                toast({ title: data.error || 'Submission failed', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Network error — please try again', variant: 'destructive' });
        } finally {
            setSubmitting(false);
        }
    };

    const sectionIndex = SECTIONS.findIndex((s) => s.id === activeSection);
    const isFirstSection = sectionIndex <= 0;
    const isLastSection = sectionIndex === SECTIONS.length - 1;
    const goPreviousSection = () => { if (!isFirstSection) setActiveSection(SECTIONS[sectionIndex - 1].id); };
    const goNextSection = () => { if (!isLastSection) setActiveSection(SECTIONS[sectionIndex + 1].id); };

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (linkError) {
        return (
            <div className="flex min-h-screen items-center justify-center px-4">
                <div className="max-w-sm text-center space-y-3">
                    <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
                    <h1 className="text-lg font-semibold text-gray-800">{linkError}</h1>
                    <p className="text-sm text-gray-500">Please contact HR for a new link.</p>
                </div>
            </div>
        );
    }

    if (submitted) {
        return (
            <div className="flex min-h-screen items-center justify-center px-4">
                <div className="max-w-sm text-center space-y-3">
                    <CheckCircle2 className="h-10 w-10 text-primary mx-auto" />
                    <h1 className="text-lg font-semibold text-gray-800">Thank you!</h1>
                    <p className="text-sm text-gray-500">
                        Your details have been submitted to HR for review. They&apos;ll be in touch once your
                        application has been processed.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto px-4 py-10">
            <div className="flex items-center gap-3 mb-8">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                    <Building2 className="h-6 w-6 text-primary" />
                </div>
                <div>
                    <h1 className="text-xl font-bold text-gray-800">{companyNameFull}</h1>
                    <p className="text-sm text-gray-500">Employee Profile Details — new joinee onboarding</p>
                </div>
            </div>

            <OnboardingRequestForm
                values={values} onChange={handleChange} onChildrenChange={handleChildrenChange}
                disabled={submitting}
                activeSection={activeSection}
                onSectionChange={setActiveSection}
                errors={fieldErrors}
                onBlurField={handleBlurField}
                isFieldRequiredOverride={isPublicFieldRequired}
                documentsSlot={
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {TILE_DEFS.map((def) => {
                            const existing = findExisting(def.category, def.subtype);
                            return (
                                <OnboardingDocumentTile
                                    key={`${def.category}:${def.subtype ?? ''}`}
                                    label={def.label}
                                    existingDoc={existing ? { id: existing.id, fileName: existing.fileName, status: existing.status } : null}
                                    onUpload={(file) => uploadTo(def.category, def.subtype, file)}
                                    imageCategory={def.subtype === 'Photo' ? 'portrait' : 'document'}
                                    onDelete={existing ? () => deleteDoc(existing.id) : undefined}
                                    readOnly={submitted}
                                />
                            );
                        })}
                    </div>
                }
            />

            <div className="mt-6 flex items-center justify-between pt-4 border-t flex-wrap gap-3">
                <Button variant="outline" onClick={goPreviousSection} disabled={isFirstSection || submitting} className="gap-2">
                    <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                {isLastSection ? (
                    <Button onClick={handleSubmit} disabled={submitting} size="lg" className="gap-2">
                        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                        Submit
                    </Button>
                ) : (
                    <Button onClick={goNextSection} className="gap-2">
                        Next <ChevronRight className="h-4 w-4" />
                    </Button>
                )}
            </div>
        </div>
    );
}
