'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Save, AlertCircle, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { useHrOnboardingValidation, type HrOnboardingFieldConfig } from '@/hooks/useHrOnboardingValidation';
import { useOnboardingApprovalLevels } from '@/hooks/useOnboardingApprovalLevels';
import { PageLoader } from '@/components/ui/page-loader';

// Same tabs, in the same order, as the manual-entry form's tab bar
// (SECTIONS in OnboardingRequestForm.tsx). "Finalize Employee Details" is not
// a tab on that form — the approver fills it in after intake — so it comes
// last. Field order inside each tab comes from the API, which sorts by
// app/lib/hr/onboarding-field-definitions.ts.
const SECTIONS: { id: HrOnboardingFieldConfig['section']; label: string; description: string }[] = [
    { id: 'personal', label: 'Personal Details', description: 'Name, contact, and personal information' },
    { id: 'address', label: 'Address', description: 'Current/permanent address and emergency contact' },
    { id: 'identity', label: 'Identity & Statutory', description: 'Aadhaar, PAN, and other statutory numbers' },
    { id: 'bank', label: 'Bank Details', description: 'Salary account details' },
    { id: 'insurance', label: 'Vehicle Insurance', description: 'Employee vehicle insurance policy details' },
    { id: 'family', label: 'Family Details', description: 'Parents, spouse, and children' },
    { id: 'documents', label: 'Documents', description: 'Which supporting documents are required for a New Employee request' },
    { id: 'organization', label: 'Finalize Employee Details', description: 'Department, designation, reporting manager, joining date, and month CTC pay — collected by the approver at final approval, not on the intake form. Branch is chosen separately at Submit for Approval and isn\'t configurable here.' },
];

// Pair wife and husband fields into unified Spouse rows in the Family Details tab
// so HR admins configure "Spouse Name", "Spouse Age", etc. once for both genders.
interface SpouseFieldPair {
    spouseKey: string;
    label: string;
    maleKey: string;
    femaleKey: string;
}

const SPOUSE_FIELD_PAIRS: SpouseFieldPair[] = [
    { spouseKey: 'spouseName', label: 'Spouse Name', maleKey: 'wifeName', femaleKey: 'husbandName' },
    { spouseKey: 'spouseAge', label: 'Spouse Age', maleKey: 'wifeAge', femaleKey: 'husbandAge' },
    { spouseKey: 'spouseAadhaarNumber', label: 'Spouse Aadhaar Number', maleKey: 'wifeAadhaarNumber', femaleKey: 'husbandAadhaarNumber' },
    { spouseKey: 'spouseBankAccountNumber', label: 'Spouse Bank Account Number', maleKey: 'wifeBankAccountNumber', femaleKey: 'husbandBankAccountNumber' },
    { spouseKey: 'spouseIfscCode', label: 'Spouse IFSC Code', maleKey: 'wifeIfscCode', femaleKey: 'husbandIfscCode' },
    { spouseKey: 'spouseContactNumber', label: 'Spouse Contact Number', maleKey: 'wifeContactNumber', femaleKey: 'husbandContactNumber' },
];

const WIFE_KEYS = new Set(SPOUSE_FIELD_PAIRS.map((p) => p.maleKey));
const HUSBAND_KEYS = new Set(SPOUSE_FIELD_PAIRS.map((p) => p.femaleKey));

export function HrOnboardingFieldConfigAdmin() {
    const { toast } = useToast();
    const { configArray, isLoading, error, refetch } = useHrOnboardingValidation();
    const [localConfig, setLocalConfig] = useState<Record<string, boolean>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);

    // A useMemo here would run this seeding as a side effect during render —
    // React doesn't guarantee that runs exactly once (Strict Mode double-
    // invokes, and a discarded render throws its setState call away without
    // React necessarily recomputing the memo again), so under late-arriving
    // configArray data localConfig could silently never get seeded. useEffect
    // runs after commit and is the correct tool for syncing state to a prop.
    useEffect(() => {
        if (configArray.length > 0 && Object.keys(localConfig).length === 0) {
            const initial: Record<string, boolean> = {};
            configArray.forEach((field) => { initial[field.fieldKey] = field.isRequired; });
            setLocalConfig(initial);
        }
    }, [configArray, localConfig]);

    // The Reporting Manager row belongs to the approver's Finalize panel, which
    // only shows that field while the onboarding approval chain (Approval
    // Settings) has more than one level — so it is only configurable then too.
    const { showReportingManagers } = useOnboardingApprovalLevels();

    const fieldsBySection = useMemo(() => {
        const grouped: Record<string, HrOnboardingFieldConfig[]> = {};
        SECTIONS.forEach((s) => { grouped[s.id] = []; });
        configArray.forEach((field) => {
            if (field.fieldKey === 'reportingManagerId' && !showReportingManagers) return;

            // In family section, replace individual wife and husband keys with unified Spouse rows
            if (field.section === 'family') {
                if (HUSBAND_KEYS.has(field.fieldKey)) {
                    // Handled by the spouse pair corresponding to the wife key
                    return;
                }
                if (WIFE_KEYS.has(field.fieldKey)) {
                    const pair = SPOUSE_FIELD_PAIRS.find((p) => p.maleKey === field.fieldKey);
                    if (pair) {
                        grouped.family.push({
                            fieldKey: pair.spouseKey,
                            fieldLabel: pair.label,
                            section: 'family',
                            isRequired: field.isRequired,
                            isAlwaysRequired: false,
                        });
                    }
                    return;
                }
            }

            (grouped[field.section] ?? grouped.personal).push(field);
        });
        return grouped;
    }, [configArray, showReportingManagers]);

    const handleToggle = useCallback((fieldKey: string, isRequired: boolean) => {
        const pair = SPOUSE_FIELD_PAIRS.find((p) => p.spouseKey === fieldKey);
        if (pair) {
            setLocalConfig((prev) => ({
                ...prev,
                [pair.maleKey]: isRequired,
                [pair.femaleKey]: isRequired,
            }));
        } else {
            setLocalConfig((prev) => ({ ...prev, [fieldKey]: isRequired }));
        }
        setHasChanges(true);
    }, []);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const updates = configArray
                .filter((field) => localConfig[field.fieldKey] !== field.isRequired)
                .map((field) => ({ fieldKey: field.fieldKey, isRequired: localConfig[field.fieldKey] }));

            if (updates.length === 0) {
                toast({ title: 'No changes', description: 'No configuration changes were made.' });
                return;
            }

            const res = await apiClient.post('/hr/onboarding-field-config', { updates });
            if (!res.success) throw new Error(res.error || 'Failed to save configuration');

            toast({ title: 'Saved', description: `Saved configuration for ${updates.length} field(s).` });
            setHasChanges(false);
            // Re-sync configArray with what was actually persisted, then clear
            // localConfig so the seeding effect re-populates it from the fresh
            // values — otherwise a second save's diff (`localConfig[key] !==
            // field.isRequired`) compares against the pre-save snapshot.
            await refetch();
            setLocalConfig({});
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to save configuration';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) return <PageLoader label="Loading configuration..." fullScreen={false} />;

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                    <ListChecks className="h-7 w-7 text-white" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">
                        New Employee Onboarding — Field Validation
                    </h1>
                    <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                        Configure which onboarding fields are required. Fields marked <strong>Always Required</strong> are
                        locked — the system depends on them to create the employee&apos;s account.
                    </p>
                </div>
            </div>

            {error && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error Loading Configuration</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {hasChanges && (
                <Alert className="border-primary/30 bg-green-50 dark:border-brand-green-darker dark:bg-green-950">
                    <AlertCircle className="h-4 w-4 text-primary dark:text-primary" />
                    <AlertTitle className="text-foreground dark:text-green-100">Unsaved Changes</AlertTitle>
                    <AlertDescription className="text-sidebar-accent dark:text-green-200">
                        Click &quot;Save Configuration&quot; to apply your changes.
                    </AlertDescription>
                </Alert>
            )}

            <Tabs defaultValue={SECTIONS[0].id}>
                <TabsList className="flex h-auto w-full flex-wrap gap-1">
                    {SECTIONS.map((s) => (
                        <TabsTrigger
                            key={s.id}
                            value={s.id}
                            className="min-w-[130px] flex-1 whitespace-normal text-center leading-tight"
                        >
                            {s.label}
                        </TabsTrigger>
                    ))}
                </TabsList>

                {SECTIONS.map((section) => (
                    <TabsContent key={section.id} value={section.id}>
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">{section.label}</CardTitle>
                                <CardDescription>{section.description}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4">
                                    {fieldsBySection[section.id]?.map((field) => {
                                        const pair = SPOUSE_FIELD_PAIRS.find((p) => p.spouseKey === field.fieldKey);
                                        const isCurrentRequired = pair
                                            ? (localConfig[pair.maleKey] ?? configArray.find((c) => c.fieldKey === pair.maleKey)?.isRequired ?? false) ||
                                              (localConfig[pair.femaleKey] ?? configArray.find((c) => c.fieldKey === pair.femaleKey)?.isRequired ?? false)
                                            : (localConfig[field.fieldKey] ?? field.isRequired);

                                        return (
                                            <FieldToggleRow
                                                key={field.fieldKey}
                                                field={field}
                                                isRequired={isCurrentRequired}
                                                onToggle={() => handleToggle(field.fieldKey, !isCurrentRequired)}
                                                disabled={field.isAlwaysRequired}
                                            />
                                        );
                                    })}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                ))}
            </Tabs>

            <div className="flex justify-end gap-2">
                <Button onClick={handleSave} disabled={!hasChanges || isSaving} size="lg" className="gap-2">
                    <Save className="h-4 w-4" />
                    {isSaving ? 'Saving...' : 'Save Configuration'}
                </Button>
            </div>
        </div>
    );
}

interface FieldToggleRowProps {
    field: HrOnboardingFieldConfig;
    isRequired: boolean;
    onToggle: () => void;
    disabled: boolean;
}

function FieldToggleRow({ field, isRequired, onToggle, disabled }: FieldToggleRowProps) {
    return (
        <div className="flex items-center justify-between rounded-lg border border-primary/20 p-4 dark:border-sidebar-accent">
            <div className="flex-1">
                <div className="flex items-center gap-2">
                    <Label className="text-sm font-medium text-foreground dark:text-white cursor-pointer">
                        {field.fieldLabel}
                    </Label>
                    {disabled && (
                        <span className="inline-block px-2 py-1 text-xs font-semibold text-red-600 bg-red-50 rounded dark:text-red-400 dark:bg-red-950">
                            Always Required
                        </span>
                    )}
                    {isRequired && !disabled && <span className="inline-block text-red-500">*</span>}
                    {!isRequired && !disabled && (
                        <span className="inline-block px-2 py-1 text-xs text-slate-500 dark:text-slate-400">Optional</span>
                    )}
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {field.fieldKey.startsWith('spouse')
                        ? 'Applies to both male and female married employees'
                        : field.fieldKey.startsWith('child')
                            ? 'Applies to every child row added — adding children stays optional'
                            : field.fieldKey}
                </p>
            </div>
            <Switch checked={isRequired} onCheckedChange={onToggle} disabled={disabled} aria-label={`Toggle ${field.fieldLabel} requirement`} />
        </div>
    );
}
