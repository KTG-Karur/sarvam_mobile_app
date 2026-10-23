'use client';

import { useCallback, useEffect, useState } from 'react';
import { Reorder, motion, AnimatePresence } from 'framer-motion';
import {
    ArrowDown,
    Check,
    CheckCircle2,
    GripVertical,
    Plus,
    Trash2,
    Save,
    RefreshCw,
    Users,
    ShieldCheck,
    AlertCircle,
    ChevronRight,
    Banknote,
    Loader2,
} from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { cn } from '@/lib/utils';
import {
    advanceWorkflowSchema,
    workflowSchema,
    type AdvanceWorkflowInput,
    type WorkflowInput,
    type WorkflowKind,
    type WorkflowRecord,
    type WorkflowResponse,
} from '@/app/lib/staff-loans/configuration';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { PageLoader } from '@/components/ui/page-loader';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

type StageDraft = {
    localId: string;
    stageName: string;
    roleId: string;
    roleName: string;
};

const STAGE_COLORS = [
    '#3b82f6', // blue
    '#8b5cf6', // purple
    '#059669', // emerald
    '#d97706', // amber
    '#db2777', // pink
    '#0891b2', // cyan
    '#4f46e5', // indigo
];

function getStageColor(index: number) {
    return STAGE_COLORS[index % STAGE_COLORS.length];
}

// Staff Loan and Staff Advance each have their own workflow (stages, salary date, active flag) on this page.
// Both editors stay mounted so unsaved edits survive switching tabs.
export default function StaffLoanWorkflowPage() {
    const [tab, setTab] = useState<WorkflowKind>('LOAN');
    return (
        <div>
            <div className="mx-auto max-w-5xl px-4 pt-4 md:px-6">
                <Tabs value={tab} onValueChange={value => setTab(value as WorkflowKind)}>
                    <TabsList>
                        <TabsTrigger value="LOAN">Staff Loan Workflow</TabsTrigger>
                        <TabsTrigger value="ADVANCE">Staff Advance Workflow</TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>
            <div className={tab === 'LOAN' ? undefined : 'hidden'}><WorkflowEditor kind="LOAN" /></div>
            <div className={tab === 'ADVANCE' ? undefined : 'hidden'}><WorkflowEditor kind="ADVANCE" /></div>
        </div>
    );
}

const COPY = {
    LOAN: {
        noun: 'Staff Loan', nounLower: 'staff loan', defaultName: 'Staff Loan Approval Workflow',
        applicationLabel: 'Staff Loan Application', applicationSub: 'Employee applies and agrees to repayment terms',
        finalSub: 'Loan approved and routed to disbursement queue',
        disburseNoun: 'Loan',
        salaryHelp: 'Staff loan installments fall due on this day every month. When it falls on a Sunday, the due date moves to the previous day. In months shorter than this day, the last day of the month is used.',
        salaryUnset: 'Not set yet. Until it is saved, loans are disbursed with a manually entered first due date.',
        namePlaceholder: 'e.g. Standard Staff Loan Flow', headerText: 'Configure multi-level approval stages and disbursement governance. Drag stages to reorder.',
        applicants: 'new loan applications',
    },
    ADVANCE: {
        noun: 'Staff Advance', nounLower: 'staff advance', defaultName: 'Staff Advance Approval Workflow',
        applicationLabel: 'Staff Advance Application', applicationSub: 'Employee requests an interest-free advance repaid in 1 or 2 monthly installments',
        finalSub: 'Advance approved and routed to disbursement queue',
        disburseNoun: 'Advance',
        salaryHelp: '',
        salaryUnset: '',
        namePlaceholder: 'e.g. Standard Staff Advance Flow', headerText: 'Configure multi-level approval stages and disbursement governance for staff advances. Drag stages to reorder.',
        applicants: 'new advance applications',
    },
} as const;

function WorkflowEditor({ kind }: { kind: WorkflowKind }) {
    const copy = COPY[kind];
    const isAdvance = kind === 'ADVANCE';
    const endpoint = `/admin/staff-loan-workflow?kind=${kind}`;
    const { toast } = useToast();
    const [data, setData] = useState<WorkflowResponse | null>(null);
    const [name, setName] = useState<string>(copy.defaultName);
    const [isActive, setIsActive] = useState(false);
    const [salaryDay, setSalaryDay] = useState('');
    const [stages, setStages] = useState<StageDraft[]>([]);
    const [disbursementRoleIds, setDisbursementRoleIds] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [pending, setPending] = useState<WorkflowInput | AdvanceWorkflowInput | null>(null);
    const [dirty, setDirty] = useState(false);
    const [reloadOpen, setReloadOpen] = useState(false);

    // New stage form state
    const [newRoleId, setNewRoleId] = useState('');
    const [newStageName, setNewStageName] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError('');
        try {
            const response = await apiClient.get<WorkflowResponse>(endpoint);
            if (!response.success || !response.data) {
                throw new Error(response.error || 'Unable to load workflow configuration');
            }
            const loaded = response.data;
            setData(loaded);
            setName(loaded.config?.name ?? copy.defaultName);
            setIsActive(loaded.config?.isActive ?? false);
            setSalaryDay(loaded.config?.salaryDay != null ? String(loaded.config.salaryDay) : '');
            setStages(
                loaded.config?.stages.map(s => {
                    const matchedRole = loaded.roles.find(r => r.id === s.roleId);
                    return {
                        localId: crypto.randomUUID(),
                        stageName: s.stageName,
                        roleId: s.roleId,
                        roleName: matchedRole ? matchedRole.name : 'Unknown Role',
                    };
                }) ?? []
            );
            setDisbursementRoleIds(loaded.config?.disbursementRoleIds ?? []);
            setErrors({});
            setDirty(false);
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : 'Unable to load workflow');
        } finally {
            setLoading(false);
        }
    }, [endpoint, copy.defaultName]);

    useEffect(() => {
        void load();
    }, [load]);

    const canSave = !!data && (data.config ? data.capabilities.edit : data.capabilities.add);

    function handleReorder(newOrder: StageDraft[]) {
        setStages(newOrder);
        setDirty(true);
        setErrors({});
    }

    function addStage() {
        if (!newRoleId) return;
        const role = data?.roles.find(r => r.id === newRoleId);
        if (!role) return;

        const stageTitle = newStageName.trim() || `${role.name} Review`;
        const newStage: StageDraft = {
            localId: crypto.randomUUID(),
            stageName: stageTitle,
            roleId: role.id,
            roleName: role.name,
        };

        setStages(prev => [...prev, newStage]);
        setNewRoleId('');
        setNewStageName('');
        setDirty(true);
        setErrors({});
    }

    function removeStage(localId: string) {
        setStages(prev => prev.filter(s => s.localId !== localId));
        setDirty(true);
        setErrors({});
    }

    function prepareSave(event: React.FormEvent) {
        event.preventDefault();
        const draft = {
            expectedConfigId: data?.config?.id ?? null,
            name,
            isActive,
            stages: stages.map((stage, i) => ({
                levelOrder: i + 1,
                stageName: stage.stageName,
                roleId: stage.roleId,
            })),
        };
        // The advance workflow has no salary date (its installments follow the disbursement date).
        const result = isAdvance
            ? advanceWorkflowSchema.safeParse({ ...draft, disbursementRoleIds })
            : workflowSchema.safeParse({ ...draft, salaryDay: salaryDay.trim() === '' ? undefined : Number(salaryDay), disbursementRoleIds });

        if (!result.success) {
            const fieldErrors: Record<string, string> = {};
            for (const issue of result.error.issues) {
                fieldErrors[issue.path.join('.')] = issue.message;
            }
            setErrors(fieldErrors);
            if (result.error.issues.length > 0) {
                toast({
                    title: 'Validation Error',
                    description: result.error.issues[0].message,
                    variant: 'destructive',
                });
            }
            return;
        }

        setErrors({});
        setPending(result.data);
    }

    async function save() {
        if (!pending || !canSave || saving) return;
        setSaving(true);
        try {
            const response = await apiClient.put<WorkflowRecord>(endpoint, pending);
            if (!response.success || !response.data) {
                throw new Error(response.error || 'Unable to save workflow');
            }
            const saved = response.data;
            setData(previous => (previous ? { ...previous, config: saved } : previous));
            setName(saved.name);
            setDirty(false);
            setPending(null);
            toast({
                title: 'Saved',
                description: `${copy.noun} approval workflow saved. Changes apply to new submissions.`,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to save workflow';
            setErrors({ form: message });
            setPending(null);
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return <PageLoader fullScreen={false} label={`Loading ${copy.nounLower} workflow...`} />;
    }

    // Filter available roles to active roles not already used in middle stages
    const usedRoleIds = new Set(stages.map(s => s.roleId));
    const availableRoles = (data?.roles ?? []).filter(r => r.isActive && !usedRoleIds.has(r.id));

    return (
        <div className="mx-auto max-w-5xl p-4 md:p-6 space-y-6">
            {/* Page Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <ShieldCheck className="h-6 w-6 text-primary" />
                        {copy.noun} Approval Workflow
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        {copy.headerText}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Badge variant={data?.config?.isActive ? 'default' : 'secondary'} className="text-xs px-2.5 py-1">
                        {data?.config ? (data.config.isActive ? 'Active Workflow' : 'Inactive') : 'Unconfigured'}
                    </Badge>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={saving}
                        onClick={() => (dirty ? setReloadOpen(true) : void load())}
                    >
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                        Reload
                    </Button>
                </div>
            </div>

            {/* Active Status Banner */}
            {data?.config?.isActive && (
                <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg px-4 py-2.5">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                    <span>
                        {copy.noun} workflow is <strong>active</strong>. {isAdvance ? 'New advance applications' : 'New loan applications'} will follow this configured order.
                    </span>
                </div>
            )}

            {loadError ? (
                <div className="p-4 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20">
                    {loadError}
                </div>
            ) : (
                <form onSubmit={prepareSave} className="space-y-6" noValidate>
                    <fieldset disabled={saving || !canSave} className="space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Left Column: Approval Flow Canvas & Disbursement Roles */}
                            <div className="lg:col-span-2 space-y-5">
                                {/* Flow Canvas Card */}
                                <Card className="shadow-sm">
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-base font-semibold">Approval Flow</CardTitle>
                                        <CardDescription className="text-xs">
                                            Drag stages to reorder. Initial submission and final approval nodes are fixed.
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        {/* Fixed Initial Node */}
                                        <FixedStageNode
                                            label={copy.applicationLabel}
                                            sublabel={copy.applicationSub}
                                            color="#10b981"
                                            icon={<Users className="h-4 w-4" />}
                                        />

                                        <FlowArrow />

                                        {/* Reorderable Middle Stages */}
                                        {stages.length === 0 ? (
                                            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center text-muted-foreground text-sm">
                                                No review stages configured. Add a stage from the right panel →
                                            </div>
                                        ) : (
                                            <Reorder.Group
                                                axis="y"
                                                values={stages}
                                                onReorder={handleReorder}
                                                className="space-y-2"
                                            >
                                                <AnimatePresence>
                                                    {stages.map((stage, index) => {
                                                        const color = getStageColor(index);
                                                        return (
                                                            <Reorder.Item
                                                                key={stage.localId}
                                                                value={stage}
                                                                className="cursor-grab active:cursor-grabbing"
                                                            >
                                                                <motion.div
                                                                    layout
                                                                    initial={{ opacity: 0, y: -10 }}
                                                                    animate={{ opacity: 1, y: 0 }}
                                                                    exit={{ opacity: 0, scale: 0.95 }}
                                                                    className="flex items-center gap-3 bg-card border rounded-lg p-3 shadow-sm hover:border-primary/40 transition-colors"
                                                                >
                                                                    <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                                                    <div
                                                                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                                                                        style={{ backgroundColor: color }}
                                                                    >
                                                                        {index + 1}
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <p className="font-semibold text-sm text-foreground truncate">
                                                                            {stage.stageName}
                                                                        </p>
                                                                        <p className="text-xs text-muted-foreground truncate">
                                                                            Approver Role: {stage.roleName}
                                                                        </p>
                                                                    </div>
                                                                    <Badge
                                                                        variant="outline"
                                                                        className="text-xs flex-shrink-0"
                                                                        style={{ borderColor: color, color }}
                                                                    >
                                                                        Level {index + 1}
                                                                    </Badge>
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                                                        onClick={() => removeStage(stage.localId)}
                                                                        aria-label={`Remove stage ${stage.stageName}`}
                                                                    >
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </Button>
                                                                </motion.div>
                                                            </Reorder.Item>
                                                        );
                                                    })}
                                                </AnimatePresence>
                                            </Reorder.Group>
                                        )}

                                        {stages.length > 0 && <FlowArrow />}

                                        {/* Fixed Final Node */}
                                        <FixedStageNode
                                            label="Final Approval Completed"
                                            sublabel={copy.finalSub}
                                            color="#3b82f6"
                                            icon={<ShieldCheck className="h-4 w-4" />}
                                        />
                                    </CardContent>
                                </Card>

                                {/* Disbursement Authority Card */}
                                <Card className="shadow-sm">
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-base font-semibold flex items-center gap-2">
                                            <Banknote className="h-4 w-4 text-primary" />
                                            {copy.disburseNoun} Disbursement Authority
                                        </CardTitle>
                                        <CardDescription className="text-xs">
                                            Select roles authorized to execute {copy.disburseNoun.toLowerCase()} disbursements once the final approval stage is signed off.
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                            {(data?.roles ?? [])
                                                .filter(r => r.isActive)
                                                .map(role => {
                                                    const isSelected = disbursementRoleIds.includes(role.id);
                                                    return (
                                                        <div
                                                            key={role.id}
                                                            onClick={() => {
                                                                if (saving || !canSave) return;
                                                                setDisbursementRoleIds(prev =>
                                                                    isSelected
                                                                        ? prev.filter(id => id !== role.id)
                                                                        : [...prev, role.id]
                                                                );
                                                                setDirty(true);
                                                            }}
                                                            className={`flex items-center gap-2.5 p-3 rounded-lg border text-xs cursor-pointer transition-colors ${
                                                                isSelected
                                                                    ? 'bg-primary/10 border-primary font-medium text-foreground'
                                                                    : 'hover:bg-muted/50 border-input text-muted-foreground'
                                                            }`}
                                                        >
                                                            <div
                                                                aria-hidden="true"
                                                                className={cn(
                                                                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary',
                                                                    isSelected && 'bg-primary text-primary-foreground'
                                                                )}
                                                            >
                                                                {isSelected && <Check className="h-4 w-4" />}
                                                            </div>
                                                            <span className="font-medium text-sm">{role.name}</span>
                                                        </div>
                                                    );
                                                })}
                                        </div>
                                        {errors.disbursementRoleIds && (
                                            <p className="text-xs text-destructive mt-1">
                                                {errors.disbursementRoleIds}
                                            </p>
                                        )}
                                    </CardContent>
                                </Card>

                                {/* Bottom Save Bar */}
                                {canSave && (
                                    <div className="flex items-center justify-end gap-3 pt-2">
                                        <Button
                                            type="submit"
                                            disabled={saving || !dirty || stages.length === 0}
                                            className="min-w-[140px] gap-2"
                                        >
                                            {saving ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <Save className="h-4 w-4" />
                                            )}
                                            Save Workflow
                                        </Button>
                                    </div>
                                )}
                            </div>

                            {/* Right Column: Settings, Add Stage & Legend */}
                            <div className="space-y-4">
                                {/* Workflow Settings Card */}
                                <Card className="shadow-sm">
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-base font-semibold">Workflow Settings</CardTitle>
                                        <CardDescription className="text-xs">
                                            Configure general workflow properties.
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="space-y-1.5">
                                            <Label htmlFor="workflow-name" className="text-xs font-medium">
                                                Workflow Name *
                                            </Label>
                                            <Input
                                                id="workflow-name"
                                                value={name}
                                                onChange={e => {
                                                    setName(e.target.value);
                                                    setDirty(true);
                                                }}
                                                placeholder={copy.namePlaceholder}
                                                className="h-9 text-sm"
                                            />
                                            {errors.name && (
                                                <p className="text-xs text-destructive">{errors.name}</p>
                                            )}
                                        </div>

                                        {isAdvance && (
                                            <p className="rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">
                                                Advance installments follow the <strong>salary date set on the Staff Loan Workflow tab</strong>, with the same
                                                &quot;this month / next month&quot; first due date choice at disbursement.
                                            </p>
                                        )}

                                        {!isAdvance && (<div className="space-y-1.5">
                                            <Label htmlFor="workflow-salary-day" className="text-xs font-medium">
                                                Salary Date (day of month) *
                                            </Label>
                                            <Input
                                                id="workflow-salary-day"
                                                type="number"
                                                min={1}
                                                max={31}
                                                step={1}
                                                inputMode="numeric"
                                                value={salaryDay}
                                                onChange={e => {
                                                    setSalaryDay(e.target.value);
                                                    setDirty(true);
                                                }}
                                                placeholder="e.g. 5"
                                                className="h-9 text-sm"
                                                aria-invalid={!!errors.salaryDay}
                                            />
                                            <p className="text-[11px] text-muted-foreground">
                                                {copy.salaryHelp}
                                            </p>
                                            {data?.config && data.config.salaryDay == null && !errors.salaryDay && (
                                                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                                                    {copy.salaryUnset}
                                                </p>
                                            )}
                                            {errors.salaryDay && (
                                                <p className="text-xs text-destructive">{errors.salaryDay}</p>
                                            )}
                                        </div>)}

                                        <div className="flex items-center justify-between pt-1 border-t">
                                            <div className="space-y-0.5">
                                                <Label htmlFor="workflow-active" className="text-xs font-medium">
                                                    Active Status
                                                </Label>
                                                <p className="text-[11px] text-muted-foreground">
                                                    Enable for new submissions
                                                </p>
                                            </div>
                                            <Switch
                                                id="workflow-active"
                                                checked={isActive}
                                                onCheckedChange={val => {
                                                    setIsActive(val);
                                                    setDirty(true);
                                                }}
                                            />
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* Add Stage Card */}
                                <Card className="shadow-sm">
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-base font-semibold">Add Review Stage</CardTitle>
                                        <CardDescription className="text-xs">
                                            Select an approver role to insert into the workflow.
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        <div className="space-y-1.5">
                                            <Label className="text-xs font-medium">Approver Role *</Label>
                                            <Select value={newRoleId} onValueChange={setNewRoleId}>
                                                <SelectTrigger className="h-9 text-sm">
                                                    <SelectValue placeholder="Select approver role..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {availableRoles.length === 0 ? (
                                                        <div className="p-3 text-center text-xs text-muted-foreground">
                                                            All active roles added
                                                        </div>
                                                    ) : (
                                                        availableRoles.map(role => (
                                                            <SelectItem key={role.id} value={role.id}>
                                                                {role.name}
                                                            </SelectItem>
                                                        ))
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="space-y-1.5">
                                            <Label className="text-xs font-medium">
                                                Stage Name <span className="text-muted-foreground text-[10px]">(optional)</span>
                                            </Label>
                                            <Input
                                                className="h-9 text-sm"
                                                placeholder="e.g. Branch Manager Review"
                                                value={newStageName}
                                                onChange={e => setNewStageName(e.target.value)}
                                            />
                                        </div>

                                        <Button
                                            type="button"
                                            onClick={addStage}
                                            disabled={!newRoleId}
                                            className="w-full gap-2 h-9 text-xs"
                                            variant="outline"
                                        >
                                            <Plus className="h-4 w-4" />
                                            Add Stage
                                        </Button>
                                    </CardContent>
                                </Card>

                                {/* Guidelines Card */}
                                <Card className="bg-muted/30 border shadow-sm">
                                    <CardContent className="pt-4 space-y-2">
                                        <div className="flex items-start gap-2">
                                            <AlertCircle className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                                            <div className="text-xs text-muted-foreground space-y-1">
                                                <p>
                                                    • Changes apply to <strong>{copy.applicants}</strong> only.
                                                </p>
                                                <p>
                                                    • Applications already under review retain their workflow version.
                                                </p>
                                                <p>
                                                    • Each approver role may only review <strong>once</strong> in the sequence.
                                                </p>
                                                <p>
                                                    • At least <strong>one review stage</strong> and <strong>one disbursement role</strong> are required.
                                                </p>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* Stage Legend */}
                                {stages.length > 0 && (
                                    <Card className="shadow-sm">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                                                Sequence Order
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-2">
                                            {stages.map((s, idx) => (
                                                <div key={s.localId} className="flex items-center gap-2 text-xs">
                                                    <div
                                                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                                        style={{ backgroundColor: getStageColor(idx) }}
                                                    />
                                                    <span className="font-semibold text-foreground">
                                                        Level {idx + 1}
                                                    </span>
                                                    <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                                    <span className="text-muted-foreground truncate">{s.stageName}</span>
                                                </div>
                                            ))}
                                        </CardContent>
                                    </Card>
                                )}
                            </div>
                        </div>
                    </fieldset>
                </form>
            )}

            {/* Save Confirmation Dialog */}
            <ConfirmationDialog
                open={!!pending}
                onOpenChange={value => {
                    if (!value && !saving) setPending(null);
                }}
                onConfirm={() => void save()}
                title={pending?.isActive ? `Activate ${copy.nounLower} workflow?` : `Save ${copy.nounLower} workflow?`}
                description={
                    pending?.isActive
                        ? `New ${copy.nounLower} submissions will follow these approval stages and disbursement assignments. Existing submissions keep their workflow.`
                        : `New ${copy.nounLower} submissions will be unavailable until an active workflow is configured. Existing submissions keep their workflow.`
                }
                confirmText="Save Workflow"
                type="info"
                isLoading={saving}
            />

            {/* Reload Confirmation Dialog */}
            <ConfirmationDialog
                open={reloadOpen}
                onOpenChange={setReloadOpen}
                onConfirm={() => {
                    setReloadOpen(false);
                    void load();
                }}
                title="Discard unsaved changes?"
                description="Your unsaved modifications will be reverted to the latest saved configuration."
                confirmText="Discard & Reload"
                type="warning"
            />
        </div>
    );
}

function FixedStageNode({
    label,
    sublabel,
    color,
    icon,
}: {
    label: string;
    sublabel: string;
    color: string;
    icon: React.ReactNode;
}) {
    return (
        <div
            className="flex items-center gap-3 rounded-lg p-3 border shadow-sm"
            style={{ borderColor: color + '40', backgroundColor: color + '10' }}
        >
            <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white flex-shrink-0"
                style={{ backgroundColor: color }}
            >
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm" style={{ color }}>
                    {label}
                </p>
                <p className="text-xs text-muted-foreground">{sublabel}</p>
            </div>
            <Badge
                variant="outline"
                className="text-xs flex-shrink-0"
                style={{ borderColor: color, color }}
            >
                Fixed
            </Badge>
        </div>
    );
}

function FlowArrow() {
    return (
        <div className="flex justify-center py-0.5">
            <ArrowDown className="h-4 w-4 text-muted-foreground" />
        </div>
    );
}
