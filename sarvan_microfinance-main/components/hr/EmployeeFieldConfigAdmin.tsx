'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { Settings2 } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import { useOnboardingApprovalLevels } from '@/hooks/useOnboardingApprovalLevels';

// Toggle-only config over the FIXED Employee Master field list (mirrors
// EnrollmentValidationConfig) — not a dynamic custom-field builder.
//
// Rows are listed in the same order, under the same section names, as the
// manual-entry onboarding form (components/hr/OnboardingRequestForm.tsx):
// Personal → Address (with Emergency Contact) → Identity & Statutory → Bank,
// then Organization, which is filled in after intake. Fields the Employee
// Master has that the intake form doesn't (PF Number, Bank Branch Name,
// Emergency Contact Relationship) sit next to their closest relative.
const FIXED_FIELDS: { fieldKey: string; fieldLabel: string; section: string }[] = [
    { fieldKey: 'firstName', fieldLabel: 'First Name', section: 'Personal Details' },
    { fieldKey: 'lastName', fieldLabel: 'Last Name', section: 'Personal Details' },
    { fieldKey: 'mobileNumber', fieldLabel: 'Mobile Number', section: 'Personal Details' },
    { fieldKey: 'email', fieldLabel: 'Email ID', section: 'Personal Details' },
    { fieldKey: 'dob', fieldLabel: 'Date of Birth', section: 'Personal Details' },
    { fieldKey: 'gender', fieldLabel: 'Gender', section: 'Personal Details' },
    { fieldKey: 'maritalStatus', fieldLabel: 'Marital Status', section: 'Personal Details' },
    { fieldKey: 'bloodGroup', fieldLabel: 'Blood Group', section: 'Personal Details' },
    { fieldKey: 'education', fieldLabel: 'Education Qualification', section: 'Personal Details' },
    { fieldKey: 'address', fieldLabel: 'Current Address', section: 'Address' },
    { fieldKey: 'permanentAddress', fieldLabel: 'Permanent Address', section: 'Address' },
    { fieldKey: 'emergencyContactName', fieldLabel: 'Emergency Contact Name', section: 'Address' },
    { fieldKey: 'emergencyContactRelation', fieldLabel: 'Emergency Contact Relationship', section: 'Address' },
    { fieldKey: 'emergencyContactMobile', fieldLabel: 'Emergency Contact Number', section: 'Address' },
    { fieldKey: 'aadhaarNumber', fieldLabel: 'Aadhaar Number', section: 'Identity & Statutory' },
    { fieldKey: 'panNumber', fieldLabel: 'PAN Number', section: 'Identity & Statutory' },
    { fieldKey: 'uanNumber', fieldLabel: 'UAN Number', section: 'Identity & Statutory' },
    { fieldKey: 'esiNumber', fieldLabel: 'ESI Number', section: 'Identity & Statutory' },
    { fieldKey: 'pfNumber', fieldLabel: 'PF Number', section: 'Identity & Statutory' },
    { fieldKey: 'bankName', fieldLabel: 'Bank Name', section: 'Bank Details' },
    { fieldKey: 'bankBranchName', fieldLabel: 'Bank Branch Name', section: 'Bank Details' },
    { fieldKey: 'bankAccountNumber', fieldLabel: 'Account Number', section: 'Bank Details' },
    { fieldKey: 'bankIfscCode', fieldLabel: 'IFSC Code', section: 'Bank Details' },
    { fieldKey: 'departmentId', fieldLabel: 'Department', section: 'Organization' },
    { fieldKey: 'designationId', fieldLabel: 'Designation', section: 'Organization' },
    { fieldKey: 'reportingManagerL1Id', fieldLabel: 'L1 Manager', section: 'Organization' },
    { fieldKey: 'reportingManagerL2Id', fieldLabel: 'L2 Manager', section: 'Organization' },
    { fieldKey: 'reportingManagerL3Id', fieldLabel: 'L3 Manager', section: 'Organization' },
];

// Only meaningful while the onboarding approval chain has more than one level.
const REPORTING_MANAGER_KEYS = new Set(['reportingManagerL1Id', 'reportingManagerL2Id', 'reportingManagerL3Id']);

type FieldConfig = {
    id: string;
    fieldKey: string;
    fieldLabel: string;
    section: string;
    isRequired: boolean;
    isAlwaysRequired: boolean;
    isVisibleToEmployee: boolean;
};

export function EmployeeFieldConfigAdmin() {
    const { toast } = useToast();
    const [configByKey, setConfigByKey] = useState<Record<string, FieldConfig>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [savingKey, setSavingKey] = useState<string | null>(null);

    const fetchConfigs = useCallback(async () => {
        try {
            const res = await apiClient.get<FieldConfig[]>('/hr/field-config');
            if (res.success && res.data) {
                const map: Record<string, FieldConfig> = {};
                res.data.forEach((c) => { map[c.fieldKey] = c; });
                setConfigByKey(map);
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch field configuration.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchConfigs();
    }, [fetchConfigs]);

    // L1/L2/L3 Manager rows follow the hr-onboarding approval chain in
    // Approval Settings: a single Admin stage has no reporting hierarchy, so
    // there is nothing to configure for them.
    const { showReportingManagers } = useOnboardingApprovalLevels();

    const rows = useMemo(() => FIXED_FIELDS
        .filter((f) => showReportingManagers || !REPORTING_MANAGER_KEYS.has(f.fieldKey))
        .map((f) => ({
            ...f,
            config: configByKey[f.fieldKey] ?? {
                id: '',
                fieldKey: f.fieldKey,
                fieldLabel: f.fieldLabel,
                section: f.section,
                isRequired: false,
                isAlwaysRequired: false,
                isVisibleToEmployee: true,
            },
        })), [configByKey, showReportingManagers]);

    const handleToggle = async (field: typeof FIXED_FIELDS[number], key: 'isRequired' | 'isAlwaysRequired' | 'isVisibleToEmployee', value: boolean) => {
        setSavingKey(field.fieldKey);
        try {
            const current = configByKey[field.fieldKey];
            const payload = {
                fieldKey: field.fieldKey,
                fieldLabel: field.fieldLabel,
                section: field.section,
                isRequired: current?.isRequired ?? false,
                isAlwaysRequired: current?.isAlwaysRequired ?? false,
                isVisibleToEmployee: current?.isVisibleToEmployee ?? true,
                [key]: value,
            };
            const res = await apiClient.post<FieldConfig>('/hr/field-config', payload);
            if (res.success && res.data) {
                setConfigByKey((prev) => ({ ...prev, [field.fieldKey]: res.data! }));
            } else {
                throw new Error(res.error || 'Save failed');
            }
        } catch (error: unknown) {
            toast({ title: 'Error', description: error instanceof Error ? error.message : 'Save failed.', variant: 'destructive' });
        } finally {
            setSavingKey(null);
        }
    };

    if (isLoading) {
        return <PageLoader label="Loading Field Configuration..." fullScreen={false} />;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-5xl space-y-6">
                <div className="mb-8 flex items-center gap-4 mt-4">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <Settings2 className="h-7 w-7 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">Employee Master Field Configuration</h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                            Choose which Employee Master fields are visible on an employee&apos;s own My Profile.
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            Which fields are <strong>required</strong> is set on the{' '}
                            <Link href="/dashboard/admin/hr-onboarding-field-config" className="text-primary underline underline-offset-2">
                                Onboarding Field Validation
                            </Link>{' '}
                            page — it drives onboarding, the joinee link and the Employee Master form alike.
                        </p>
                    </div>
                </div>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                        <TableHead>Section</TableHead>
                                        <TableHead>Field</TableHead>
                                        <TableHead className="text-center">Visible on My Profile</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.map((row) => (
                                        <TableRow key={row.fieldKey}>
                                            <TableCell className="text-sm text-slate-500">{row.section}</TableCell>
                                            <TableCell className="text-sm font-medium">{row.fieldLabel}</TableCell>
                                            <TableCell className="text-center">
                                                <Checkbox
                                                    checked={row.config.isVisibleToEmployee}
                                                    disabled={savingKey === row.fieldKey}
                                                    onCheckedChange={(checked) => handleToggle(row, 'isVisibleToEmployee', !!checked)}
                                                />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
