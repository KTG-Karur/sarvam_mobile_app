'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Pencil, Loader2, RefreshCw, X } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { schemeSchema, type SchemeRecord, type SchemeInput, type SchemesResponse } from '@/app/lib/staff-loans/configuration';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageLoader } from '@/components/ui/page-loader';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ConfigChoices, ConfigInput, ConfigSelect, FieldError } from './ConfigurationFields';

type FormValues = Record<string, string>;
const emptyValues = (): FormValues => Object.fromEntries([
    'code', 'name', 'description', 'minimumServiceMonths', 'minimumSalaryPerMonth', 'amountBasis', 'maximumAmount', 'salaryMultiplier',
    'maximumTenureMonths', 'maximumActiveLoans', 'interestType', 'annualInterestRate',
].map(key => [key, '']));

const emptySelections = () => ({
    branchIds: [] as string[],
    departmentIds: [] as string[],
    roleIds: [] as string[],
    salaryBasisComponentIds: [] as string[],
});

const numberValue = (value: string) => value.trim() === '' ? NaN : Number(value);
const options = (values: [string, string][]) => values.map(([value, label]) => ({ value, label }));

const formatINR = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);

const INTEREST_RATE_LABELS: Record<string, string> = {
    FLAT: 'Annual flat-interest rate (%)',
    MONTHLY: 'Monthly flat-interest rate (%)',
};

const TAB_ORDER = ['details', 'eligibility', 'interest'] as const;

const FIELD_TABS: Record<string, string> = {
    code: 'details', name: 'details', description: 'details',
    minimumServiceMonths: 'eligibility', minimumSalaryPerMonth: 'eligibility', amountBasis: 'eligibility',
    maximumAmount: 'eligibility', salaryMultiplier: 'eligibility', salaryBasisComponentIds: 'eligibility',
    maximumTenureMonths: 'eligibility', maximumActiveLoans: 'eligibility',
    interestType: 'interest', annualInterestRate: 'interest', branchIds: 'interest', departmentIds: 'interest', roleIds: 'interest',
};

export default function StaffLoanSchemesPage() {
    const { toast } = useToast();
    const [data, setData] = useState<SchemesResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<SchemeRecord | null>(null);
    const [values, setValues] = useState<FormValues>(emptyValues);
    const [selections, setSelections] = useState(emptySelections);
    const [isActive, setIsActive] = useState(false);
    const [allowMultipleActiveLoans, setAllowMultipleActiveLoans] = useState(false);
    const [activeTab, setActiveTab] = useState('details');
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const formRef = useRef<HTMLDivElement>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError('');
        try {
            const response = await apiClient.get<SchemesResponse>('/admin/staff-loan-schemes');
            if (!response.success || !response.data) throw new Error(response.error || 'Unable to load schemes');
            setData(response.data);
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : 'Unable to load schemes');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
        if (open) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [open]);

    const update = (key: string, value: string) => setValues(previous => ({ ...previous, [key]: value }));
    const goToTab = (offset: number) => setActiveTab(prev => {
        const index = TAB_ORDER.indexOf(prev as typeof TAB_ORDER[number]);
        return TAB_ORDER[Math.min(Math.max(index + offset, 0), TAB_ORDER.length - 1)];
    });

    function showForm(record: SchemeRecord | null) {
        setEditing(record);
        setErrors({});
        setActiveTab('details');
        if (!record) {
            setValues(emptyValues());
            setSelections({
                branchIds: (data?.options.branches ?? []).filter(o => o.isActive).map(o => o.id),
                departmentIds: (data?.options.departments ?? []).filter(o => o.isActive).map(o => o.id),
                roleIds: (data?.options.roles ?? []).filter(o => o.isActive).map(o => o.id),
                salaryBasisComponentIds: (data?.options.salaryComponents ?? []).filter(o => o.isActive).map(o => o.id),
            });
            setIsActive(true);
            setAllowMultipleActiveLoans(false);
        } else {
            const next = emptyValues();
            for (const key of Object.keys(next)) {
                const value = record[key as keyof SchemeRecord];
                if (typeof value === 'string' || typeof value === 'number') next[key] = String(value);
            }
            setValues(next);
            setSelections({
                branchIds: record.branchIds,
                departmentIds: record.departmentIds,
                roleIds: record.roleIds,
                salaryBasisComponentIds: record.salaryBasisComponentIds,
            });
            setIsActive(record.isActive);
            setAllowMultipleActiveLoans(record.maximumActiveLoans > 1);
        }
        setOpen(true);
    }

    function closeForm() {
        if (saving) return;
        setOpen(false);
        setEditing(null);
        setErrors({});
    }

    async function save(event: React.FormEvent) {
        event.preventDefault();
        const input = {
            code: values.code,
            name: values.name,
            description: values.description,
            minimumServiceMonths: numberValue(values.minimumServiceMonths),
            minimumSalaryPerMonth: values.minimumSalaryPerMonth.trim() === '' ? 0 : numberValue(values.minimumSalaryPerMonth),
            amountBasis: values.amountBasis,
            maximumAmount: values.amountBasis === 'FIXED_AMOUNT' ? numberValue(values.maximumAmount) : null,
            salaryMultiplier: values.amountBasis === 'SALARY_MULTIPLE' ? numberValue(values.salaryMultiplier) : null,
            maximumTenureMonths: numberValue(values.maximumTenureMonths),
            maximumActiveLoans: allowMultipleActiveLoans ? numberValue(values.maximumActiveLoans) : 1,
            interestType: values.interestType,
            annualInterestRate: values.interestType === 'INTEREST_FREE' ? 0 : numberValue(values.annualInterestRate),
            branchIds: selections.branchIds,
            departmentIds: selections.departmentIds,
            roleIds: selections.roleIds,
            salaryBasisComponentIds: values.amountBasis === 'SALARY_MULTIPLE' ? selections.salaryBasisComponentIds : [],
            isActive,
        };
        const parsed = schemeSchema.safeParse(input);
        if (!parsed.success) {
            setErrors(Object.fromEntries(parsed.error.issues.map(issue => [issue.path.join('.'), issue.message])));
            const firstTab = FIELD_TABS[String(parsed.error.issues[0]?.path[0] ?? '')];
            if (firstTab) setActiveTab(firstTab);
            return;
        }
        setErrors({});
        setSaving(true);
        try {
            const payload: { scheme: SchemeInput; id?: string; expectedVersion?: number } = { scheme: parsed.data };
            const response = editing
                ? await apiClient.put<SchemeRecord>('/admin/staff-loan-schemes', { ...payload, id: editing.id, expectedVersion: editing.version })
                : await apiClient.post<SchemeRecord>('/admin/staff-loan-schemes', payload);
            if (!response.success || !response.data) throw new Error(response.error || 'Unable to save scheme');
            const saved = response.data;
            setData(previous => previous ? {
                ...previous,
                schemes: [...previous.schemes.filter(s => s.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)),
            } : previous);
            setOpen(false);
            setEditing(null);
            toast({ title: 'Saved', description: 'Staff loan scheme saved successfully.' });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to save scheme';
            setErrors({ form: message });
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <PageLoader fullScreen={false} label="Loading staff loan schemes..." />;
    const text = (key: string, label: string, opts: { numeric?: boolean; step?: string; required?: boolean; errorKey?: string } = {}) => {
        const { numeric = false, step = '1', required = false, errorKey = key } = opts;
        return <ConfigInput label={label} value={values[key]} onChange={value => update(key, value)} error={errors[errorKey]} type={numeric ? 'number' : 'text'} step={numeric ? step : undefined} required={required} />;
    };
    const select = (key: string, label: string, choices: [string, string][], opts: { required?: boolean; errorKey?: string } = {}) => {
        const { required = false, errorKey = key } = opts;
        return <ConfigSelect label={label} value={values[key]} onChange={value => update(key, value)} options={options(choices)} error={errors[errorKey]} required={required} />;
    };
    const canSubmit = editing ? data?.capabilities.edit : data?.capabilities.add;

    return (
        <div className="mx-auto max-w-6xl p-4 md:p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold">Staff Loan Schemes</h1>
                    <p className="text-sm text-muted-foreground">Configure loan schemes, limits, and eligibility criteria for staff members.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
                    {!loadError && data?.capabilities.add && !open && (
                        <Button onClick={() => showForm(null)}><Plus className="mr-2 h-4 w-4" />New Scheme</Button>
                    )}
                </div>
            </div>

            {open && (
                <div ref={formRef}>
                    <Card className="border-primary/30">
                        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                            <div>
                                <CardTitle className="text-lg">{editing ? 'Edit Staff Loan Scheme' : 'New Staff Loan Scheme'}</CardTitle>
                                <p className="text-sm text-muted-foreground mt-1">
                                    Configure scheme eligibility and financial terms. Empty applicability selections apply to all branches, departments, and roles.
                                </p>
                            </div>
                            <Button type="button" variant="ghost" size="icon" disabled={saving} onClick={closeForm} aria-label="Close form">
                                <X className="h-4 w-4" />
                            </Button>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={save} className="space-y-6" noValidate>
                                <Tabs value={activeTab} onValueChange={setActiveTab}>
                                    <TabsList className="grid w-full grid-cols-3">
                                        <TabsTrigger value="details">1. Scheme Details</TabsTrigger>
                                        <TabsTrigger value="eligibility">2. Eligibility & Limits</TabsTrigger>
                                        <TabsTrigger value="interest">3. Interest & Applicability</TabsTrigger>
                                    </TabsList>

                                    <TabsContent value="details">
                                        <fieldset disabled={saving || !canSubmit}>
                                            <Card>
                                                <CardContent className="grid gap-4 md:grid-cols-2 pt-6">
                                                    {text('code', 'Scheme code', { required: true })}
                                                    {text('name', 'Scheme name', { required: true })}
                                                    <div className="md:col-span-2">
                                                        {text('description', 'Description')}
                                                    </div>
                                                    <div className="flex items-center gap-2 pt-1">
                                                        <Switch id="staff-scheme-active" checked={isActive} onCheckedChange={setIsActive} />
                                                        <Label htmlFor="staff-scheme-active" className="cursor-pointer">Active scheme</Label>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        </fieldset>
                                    </TabsContent>

                                    <TabsContent value="eligibility">
                                        <fieldset disabled={saving || !canSubmit}>
                                            <Card>
                                                <CardContent className="grid gap-4 md:grid-cols-2 pt-6">
                                                    {text('minimumServiceMonths', 'Minimum service required (months)', { numeric: true, required: true })}
                                                    {text('minimumSalaryPerMonth', 'Minimum salary per month (₹, 0 = no minimum)', { numeric: true, step: '0.01', required: true })}
                                                    {select('amountBasis', 'Maximum loan amount basis', [
                                                        ['FIXED_AMOUNT', 'Fixed amount'],
                                                        ['SALARY_MULTIPLE', 'Multiple of salary'],
                                                    ], { required: true })}
                                                    {values.amountBasis === 'FIXED_AMOUNT' && (
                                                        text('maximumAmount', 'Maximum loan amount (₹)', { numeric: true, step: '0.01', required: true })
                                                    )}
                                                    {values.amountBasis === 'SALARY_MULTIPLE' && (
                                                        <>
                                                            {text('salaryMultiplier', 'Salary multiplier (e.g. 2 for 2x salary)', { numeric: true, step: '0.0001', required: true })}
                                                            <div className="md:col-span-2">
                                                                <ConfigChoices
                                                                    label="Salary basis earnings components"
                                                                    options={data?.options.salaryComponents ?? []}
                                                                    selected={selections.salaryBasisComponentIds}
                                                                    onChange={ids => setSelections(s => ({ ...s, salaryBasisComponentIds: ids }))}
                                                                    error={errors.salaryBasisComponentIds}
                                                                    required
                                                                />
                                                            </div>
                                                        </>
                                                    )}
                                                    {text('maximumTenureMonths', 'Maximum tenure (months)', { numeric: true, required: true })}
                                                    <div className="flex items-center gap-2 pt-1">
                                                        <Switch
                                                            id="staff-scheme-multiple-active-loans"
                                                            checked={allowMultipleActiveLoans}
                                                            onCheckedChange={checked => {
                                                                setAllowMultipleActiveLoans(checked);
                                                                if (checked && !values.maximumActiveLoans) update('maximumActiveLoans', '2');
                                                            }}
                                                        />
                                                        <Label htmlFor="staff-scheme-multiple-active-loans" className="cursor-pointer">
                                                            Allow another active loan while one is still open
                                                        </Label>
                                                    </div>
                                                    {allowMultipleActiveLoans && (
                                                        text('maximumActiveLoans', 'Maximum active loans allowed', { numeric: true, required: true })
                                                    )}
                                                </CardContent>
                                            </Card>
                                        </fieldset>
                                    </TabsContent>

                                    <TabsContent value="interest">
                                        <fieldset disabled={saving || !canSubmit}>
                                            <Card>
                                                <CardContent className="grid gap-4 md:grid-cols-2 pt-6">
                                                    {select('interestType', 'Interest type', [
                                                        ['INTEREST_FREE', 'Interest-free'],
                                                        ['FLAT', 'Flat-interest (annual %)'],
                                                        ['MONTHLY', 'Monthly-interest (charged every month)'],
                                                    ], { required: true })}
                                                    {values.interestType === 'FLAT' || values.interestType === 'MONTHLY' ? (
                                                        text('annualInterestRate', INTEREST_RATE_LABELS[values.interestType], { numeric: true, step: '0.0001', required: true })
                                                    ) : (
                                                        <p className="text-sm text-muted-foreground self-center">Interest rate: 0%</p>
                                                    )}
                                                    {values.interestType === 'MONTHLY' && (
                                                        <p className="md:col-span-2 text-xs text-muted-foreground -mt-2">
                                                            Example: ₹30,000 at 1% monthly over 10 months = ₹300 interest + ₹3,000 principal = ₹3,300 per installment.
                                                        </p>
                                                    )}
                                                    <div className="md:col-span-2 grid gap-4 pt-2">
                                                        {(['branchIds', 'departmentIds', 'roleIds'] as const).map((key, i) => (
                                                            <ConfigChoices
                                                                key={key}
                                                                label={['Applicable Branches', 'Applicable Departments', 'Applicable Roles'][i]}
                                                                options={data ? [data.options.branches, data.options.departments, data.options.roles][i] : []}
                                                                selected={selections[key]}
                                                                onChange={ids => setSelections(s => ({ ...s, [key]: ids }))}
                                                                hint="Leave unselected to apply to all."
                                                                error={errors[key]}
                                                            />
                                                        ))}
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        </fieldset>
                                    </TabsContent>
                                </Tabs>

                                <FieldError message={errors.form} />
                                <div className="flex items-center justify-between gap-2">
                                    <div>
                                        {activeTab !== 'details' && (
                                            <Button type="button" variant="outline" disabled={saving} onClick={() => goToTab(-1)}>Previous</Button>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <Button type="button" variant="outline" disabled={saving} onClick={closeForm}>
                                            Cancel
                                        </Button>
                                        {activeTab !== 'interest' ? (
                                            <Button type="button" disabled={saving} onClick={() => goToTab(1)}>Next</Button>
                                        ) : canSubmit && (
                                            <Button type="submit" disabled={saving}>
                                                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                                {editing ? 'Update Scheme' : 'Create Scheme'}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                </div>
            )}

            {loadError ? <FieldError message={loadError} /> : (
                <Card>
                    <CardContent className="p-0 overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Scheme</TableHead>
                                    <TableHead>Amount Limit</TableHead>
                                    <TableHead>Tenure</TableHead>
                                    <TableHead>Interest</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {!data?.schemes.length && (
                                    <TableRow>
                                        <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                                            No staff loan schemes configured.
                                        </TableCell>
                                    </TableRow>
                                )}
                                {data?.schemes.map(scheme => {
                                    const interestLabel = scheme.interestType === 'INTEREST_FREE' ? 'Interest-free'
                                        : scheme.interestType === 'MONTHLY' ? `${scheme.annualInterestRate}% monthly`
                                        : `Flat ${scheme.annualInterestRate}% p.a.`;
                                    const principal = scheme.amountBasis === 'FIXED_AMOUNT' ? scheme.maximumAmount : null;
                                    const monthlyAmount = principal === null ? null
                                        : scheme.interestType === 'INTEREST_FREE' ? 0
                                        : scheme.interestType === 'MONTHLY' ? principal * scheme.annualInterestRate / 100
                                        : principal * scheme.annualInterestRate / 1200;
                                    return (
                                    <TableRow key={scheme.id}>
                                        <TableCell>
                                            <div className="font-medium">{scheme.name}</div>
                                            <div className="text-sm text-muted-foreground">{scheme.code}</div>
                                        </TableCell>
                                        <TableCell>
                                            {scheme.amountBasis === 'FIXED_AMOUNT'
                                                ? formatINR(scheme.maximumAmount ?? 0)
                                                : `${scheme.salaryMultiplier} × configured salary`}
                                        </TableCell>
                                        <TableCell>{scheme.maximumTenureMonths} months</TableCell>
                                        <TableCell>
                                            {monthlyAmount === null ? interestLabel : (
                                                <>
                                                    {formatINR(monthlyAmount)} <span className="text-muted-foreground text-xs">/ monthly</span>
                                                    <div className="text-xs text-muted-foreground">{interestLabel}</div>
                                                </>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={scheme.isActive ? 'default' : 'secondary'}>
                                                {scheme.isActive ? 'Active' : 'Inactive'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <Button variant="outline" size="sm" onClick={() => showForm(scheme)}>
                                                <Pencil className="mr-2 h-4 w-4" />
                                                {data.capabilities.edit ? 'Edit' : 'View'}
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
