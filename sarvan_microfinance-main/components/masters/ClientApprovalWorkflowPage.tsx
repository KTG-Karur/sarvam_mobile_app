'use client';

import { useEffect, useState, useCallback } from 'react';
import { Reorder, motion, AnimatePresence } from 'framer-motion';
import {
    GripVertical,
    Plus,
    Trash2,
    Pencil,
    Check,
    X,
    Save,
    RotateCcw,
    ArrowDown,
    CheckCircle2,
    Users,
    ShieldCheck,
    AlertCircle,
    ChevronRight,
    Loader2,
    CalendarClock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageLoader } from '@/components/ui/page-loader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';

interface RoleOption {
    id: string;
    name: string;
    slug: string;
    color?: string | null;
    description?: string | null;
    /** Sub Admin roles are final approvers — they can't be a middle stage. */
    isSubAdmin?: boolean;
}

interface WorkflowStage {
    id: string; // local UI id for reordering
    levelOrder: number;
    roleSlug: string;
    stageName: string;
    roleName: string;
    roleColor?: string | null;
}

const FIXED_COLORS: Record<string, string> = {
    'branch-manager': '#3b82f6',
    'area-manager': '#8b5cf6',
    'quality-checkers': '#f59e0b',
    'background-verification-team': '#f59e0b', // legacy slug alias
    'admin': '#ef4444',
};

function getStageColor(roleSlug: string, roleColor?: string | null) {
    return FIXED_COLORS[roleSlug] ?? roleColor ?? '#6b7280';
}

let stageCounter = 0;
function uid() {
    return `stage-${++stageCounter}-${Date.now()}`;
}

export default function ClientApprovalWorkflowPage() {
    const { toast } = useToast();
    const [roles, setRoles] = useState<RoleOption[]>([]);
    const [stages, setStages] = useState<WorkflowStage[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [hasConfig, setHasConfig] = useState(false);
    const [resetDialogOpen, setResetDialogOpen] = useState(false);

    // New stage form state
    const [newRoleSlug, setNewRoleSlug] = useState('');
    const [newStageName, setNewStageName] = useState('');

    // First Due Date validation cap — ADMIN-only control (Loan Indexation /
    // Final Disbursement). Visible only when the logged-in user is ADMIN.
    const isAdmin = tokenStorage.getUser()?.role === 'ADMIN';
    const [firstDueDateEnabled, setFirstDueDateEnabled] = useState(true);
    const [firstDueDateMaxDays, setFirstDueDateMaxDays] = useState(8);
    // Raw text of the days input — kept separate from the last-saved numeric
    // value so an in-progress edit (e.g. a cleared field) never gets persisted.
    const [firstDueDateMaxDaysDraft, setFirstDueDateMaxDaysDraft] = useState('8');
    const [firstDueDateLoading, setFirstDueDateLoading] = useState(true);
    const [firstDueDateSaving, setFirstDueDateSaving] = useState(false);

    const fetchFirstDueDateConfig = useCallback(async () => {
        if (!isAdmin) return;
        try {
            setFirstDueDateLoading(true);
            const res = await apiClient.get<{ enabled: boolean; maxDays: number }>('/settings/first-due-date');
            if (res.success && res.data) {
                setFirstDueDateEnabled(res.data.enabled);
                setFirstDueDateMaxDays(res.data.maxDays);
                setFirstDueDateMaxDaysDraft(String(res.data.maxDays));
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to load first due date setting', variant: 'destructive' });
        } finally {
            setFirstDueDateLoading(false);
        }
    }, [isAdmin, toast]);

    useEffect(() => { fetchFirstDueDateConfig(); }, [fetchFirstDueDateConfig]);

    async function saveFirstDueDateConfig(next: { enabled: boolean; maxDays: number }) {
        try {
            setFirstDueDateSaving(true);
            const res = await apiClient.put('/settings/first-due-date', next);
            if (res.success) {
                toast({ title: 'Saved', description: 'First due date setting updated.' });
            } else {
                toast({ title: 'Error', description: res.message, variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to save first due date setting', variant: 'destructive' });
        } finally {
            setFirstDueDateSaving(false);
        }
    }

    const fetchConfig = useCallback(async () => {
        try {
            setLoading(true);
            const res = await apiClient.get<{
                config: { stages: Array<{ levelOrder: number; roleSlug: string; stageName: string }> } | null;
                roles: RoleOption[];
            }>('/admin/client-workflow');
            if (res.success && res.data) {
                const { roles: fetchedRoles, config: cfg } = res.data;
                setRoles(fetchedRoles ?? []);
                if (cfg && cfg.stages.length > 0) {
                    setHasConfig(true);
                    setStages(
                        cfg.stages.map((s) => {
                            const role = fetchedRoles?.find((r: RoleOption) => r.slug === s.roleSlug);
                            return {
                                id: uid(),
                                levelOrder: s.levelOrder,
                                roleSlug: s.roleSlug,
                                stageName: s.stageName,
                                roleName: role?.name ?? s.roleSlug,
                                roleColor: role?.color,
                            };
                        })
                    );
                } else {
                    setHasConfig(false);
                }
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to load workflow config', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => { fetchConfig(); }, [fetchConfig]);

    function handleReorder(newOrder: WorkflowStage[]) {
        setStages(newOrder.map((s, i) => ({ ...s, levelOrder: i + 1 })));
    }

    function addStage() {
        if (!newRoleSlug) return;
        const role = roles.find(r => r.slug === newRoleSlug);
        if (!role) return;
        if (role.isSubAdmin) {
            toast({
                title: 'Sub Admin role not allowed',
                description: `"${role.name}" is a Sub Admin role (final approval only) and can't be added as an approval stage. Turn off Sub Admin for this role first, or choose another role.`,
                variant: 'destructive',
            });
            return;
        }
        const name = newStageName.trim() || `${role.name} Review`;
        const newStage: WorkflowStage = {
            id: uid(),
            levelOrder: stages.length + 1,
            roleSlug: newRoleSlug,
            stageName: name,
            roleName: role.name,
            roleColor: role.color,
        };
        setStages(prev => [...prev, newStage]);
        setNewRoleSlug('');
        setNewStageName('');
    }

    function removeStage(id: string) {
        setStages(prev =>
            prev.filter(s => s.id !== id).map((s, i) => ({ ...s, levelOrder: i + 1 }))
        );
    }

    // Inline stage rename — local only until "Save Workflow". Stages are keyed by
    // roleSlug, so renaming never moves members already waiting at a stage.
    const [editingStageId, setEditingStageId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');

    function startRename(stage: WorkflowStage) {
        setEditingStageId(stage.id);
        setEditingName(stage.stageName);
    }

    function commitRename() {
        const name = editingName.trim();
        if (!editingStageId) return;
        if (!name) {
            toast({ title: 'Stage name required', description: 'Each stage needs a name.', variant: 'destructive' });
            return;
        }
        setStages(prev => prev.map(s => (s.id === editingStageId ? { ...s, stageName: name } : s)));
        setEditingStageId(null);
    }

    async function saveConfig() {
        const subAdminStage = stages.find(s => roles.find(r => r.slug === s.roleSlug)?.isSubAdmin);
        if (subAdminStage) {
            toast({
                title: 'Sub Admin role not allowed',
                description: `"${subAdminStage.roleName}" is a Sub Admin role (final approval only) and can't be an approval stage. Remove that stage, or turn off Sub Admin for the role.`,
                variant: 'destructive',
            });
            return;
        }
        if (stages.length === 0) {
            toast({ title: 'Error', description: 'Add at least one stage', variant: 'destructive' });
            return;
        }
        try {
            setSaving(true);
            const res = await apiClient.put<{ strandedCount: number }>('/admin/client-workflow', {
                stages: stages.map((s, i) => ({
                    levelOrder: i + 1,
                    roleSlug: s.roleSlug,
                    stageName: s.stageName,
                })),
            });
            if (res.success) {
                setHasConfig(true);
                const stranded = res.data?.strandedCount ?? 0;
                toast(stranded > 0
                    ? {
                        title: 'Saved — check pending members',
                        description: `${stranded} member(s) are waiting at a stage that is no longer in this flow. They can't be approved until their stage exists again.`,
                        variant: 'destructive',
                    }
                    : { title: 'Saved', description: 'Workflow saved. Members already in progress continue from their current stage under the new order.' });
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to save', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to save', variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    }

    async function resetToDefault() {
        try {
            setSaving(true);
            const res = await apiClient.delete('/admin/client-workflow');
            if (res.success) {
                setHasConfig(false);
                setStages([]);
                toast({ title: 'Reset', description: 'Reverted to default approval flow.' });
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to reset', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to reset', variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return <PageLoader fullScreen={false} />;
    }

    // Roles already used in stages (for filtering)
    const usedSlugs = new Set(stages.map(s => s.roleSlug));
    // Exclude admin (fixed at end) and roles already in current stages
    const availableRoles = roles.filter(r => r.slug !== 'admin' && !usedSlugs.has(r.slug));

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-foreground dark:text-slate-100">
                    Member Approval Workflow
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                    Configure the order of approval stages between FDO enrollment and Admin final approval.
                    Drag stages to reorder. Changes apply to new enrollments only.
                    Roles marked <strong>Sub Admin</strong> (Admin → Roles) can also give final approval.
                </p>
            </div>

            {hasConfig && (
                <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg px-4 py-2">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                    Dynamic workflow is <strong>active</strong>. New enrollments follow the configured order below.
                </div>
            )}

            {isAdmin && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                            <CalendarClock className="h-4 w-4" />
                            First Due Date Validation
                        </CardTitle>
                        <CardDescription>
                            Controls the maximum gap allowed between the branch working date and a loan&apos;s
                            First Due Date, enforced at Loan Indexation and Final Disbursement. ADMIN logins are
                            always exempt from this cap; this control itself is visible to ADMIN only.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {firstDueDateLoading ? (
                            <p className="text-sm text-slate-400">Loading…</p>
                        ) : (
                            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                                <div className="flex items-center gap-3">
                                    <Switch
                                        checked={firstDueDateEnabled}
                                        disabled={firstDueDateSaving}
                                        onCheckedChange={(checked) => {
                                            setFirstDueDateEnabled(checked);
                                            saveFirstDueDateConfig({ enabled: checked, maxDays: firstDueDateMaxDays });
                                        }}
                                    />
                                    <Label className="text-sm">
                                        {firstDueDateEnabled ? 'Validation enabled' : 'Validation disabled'}
                                    </Label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Label className="text-xs text-slate-500 whitespace-nowrap">Max days</Label>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={365}
                                        value={firstDueDateMaxDaysDraft}
                                        disabled={firstDueDateSaving}
                                        className="h-9 w-24"
                                        onChange={(e) => setFirstDueDateMaxDaysDraft(e.target.value)}
                                        onBlur={() => {
                                            const parsed = Number(firstDueDateMaxDaysDraft);
                                            if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
                                                // Invalid/empty entry — revert to the last saved value.
                                                setFirstDueDateMaxDaysDraft(String(firstDueDateMaxDays));
                                                return;
                                            }
                                            setFirstDueDateMaxDays(parsed);
                                            saveFirstDueDateConfig({ enabled: firstDueDateEnabled, maxDays: parsed });
                                        }}
                                    />
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left: Flow Preview */}
                <div className="lg:col-span-2 space-y-4">
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Approval Flow</CardTitle>
                            <CardDescription>
                                Drag stages to reorder. FDO and Admin stages are fixed.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {/* Fixed: FDO */}
                            <FixedStageNode
                                label="FDO Enrollment"
                                sublabel="Member data & KYC submitted"
                                color="#22c55e"
                                icon={<Users className="h-4 w-4" />}
                            />

                            <FlowArrow />

                            {/* Dynamic stages */}
                            {stages.length === 0 ? (
                                <div className="border-2 border-dashed border-primary/20 dark:border-sidebar-accent rounded-lg p-6 text-center text-slate-400 text-sm">
                                    No middle stages configured. Add a stage from the panel →
                                </div>
                            ) : (
                                <Reorder.Group axis="y" values={stages} onReorder={handleReorder} className="space-y-2">
                                    <AnimatePresence>
                                        {stages.map((stage) => (
                                            <Reorder.Item key={stage.id} value={stage} className="cursor-grab active:cursor-grabbing">
                                                <motion.div
                                                    layout
                                                    initial={{ opacity: 0, y: -10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, scale: 0.95 }}
                                                    className="flex items-center gap-3 bg-white dark:bg-brand-green-darker border border-primary/20 dark:border-sidebar-accent rounded-lg p-3 shadow-sm"
                                                >
                                                    <GripVertical className="h-4 w-4 text-slate-400 flex-shrink-0" />
                                                    <div
                                                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                                                        style={{ backgroundColor: getStageColor(stage.roleSlug, stage.roleColor) }}
                                                    >
                                                        {stage.levelOrder}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        {editingStageId === stage.id ? (
                                                            <div
                                                                className="flex items-center gap-1"
                                                                // Keep typing/clicking here from starting a drag-reorder.
                                                                onPointerDown={(e) => e.stopPropagation()}
                                                            >
                                                                <Input
                                                                    autoFocus
                                                                    value={editingName}
                                                                    maxLength={100}
                                                                    onChange={(e) => setEditingName(e.target.value)}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter') commitRename();
                                                                        if (e.key === 'Escape') setEditingStageId(null);
                                                                    }}
                                                                    className="h-7 text-sm cursor-text"
                                                                />
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-7 w-7 text-emerald-600 hover:text-emerald-700"
                                                                    onClick={commitRename}
                                                                    title="Apply name"
                                                                >
                                                                    <Check className="h-3.5 w-3.5" />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-7 w-7 text-slate-400"
                                                                    onClick={() => setEditingStageId(null)}
                                                                    title="Cancel"
                                                                >
                                                                    <X className="h-3.5 w-3.5" />
                                                                </Button>
                                                            </div>
                                                        ) : (
                                                            <p className="font-medium text-sm text-foreground dark:text-slate-100 truncate">
                                                                {stage.stageName}
                                                            </p>
                                                        )}
                                                        <p className="text-xs text-slate-500 truncate">{stage.roleName}</p>
                                                        {roles.find(r => r.slug === stage.roleSlug)?.isSubAdmin && (
                                                            <p className="text-[11px] font-medium text-destructive">
                                                                Sub Admin role — remove this stage before saving
                                                            </p>
                                                        )}
                                                    </div>
                                                    <Badge
                                                        variant="outline"
                                                        className="text-xs flex-shrink-0"
                                                        style={{ borderColor: getStageColor(stage.roleSlug, stage.roleColor), color: getStageColor(stage.roleSlug, stage.roleColor) }}
                                                    >
                                                        Level {stage.levelOrder}
                                                    </Badge>
                                                    {editingStageId !== stage.id && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7 text-slate-400 hover:text-primary"
                                                            onPointerDown={(e) => e.stopPropagation()}
                                                            onClick={() => startRename(stage)}
                                                            title="Rename stage"
                                                        >
                                                            <Pencil className="h-3.5 w-3.5" />
                                                        </Button>
                                                    )}
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7 text-slate-400 hover:text-red-500"
                                                        onClick={() => removeStage(stage.id)}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </motion.div>
                                            </Reorder.Item>
                                        ))}
                                    </AnimatePresence>
                                </Reorder.Group>
                            )}

                            {stages.length > 0 && <FlowArrow />}

                            {/* Fixed: Admin */}
                            <FixedStageNode
                                label="Admin Final Approval"
                                sublabel="Head Office final sign-off — or any Sub Admin role"
                                color="#ef4444"
                                icon={<ShieldCheck className="h-4 w-4" />}
                            />
                        </CardContent>
                    </Card>

                    {/* Action buttons */}
                    <div className="flex items-center gap-3">
                        <Button onClick={saveConfig} disabled={saving || stages.length === 0} className="gap-2">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Save Workflow
                        </Button>

                        {hasConfig && (
                            <>
                                <Button
                                    variant="outline"
                                    className="gap-2 text-sidebar-accent"
                                    onClick={() => setResetDialogOpen(true)}
                                >
                                    <RotateCcw className="h-4 w-4" />
                                    Reset to Default
                                </Button>
                                <ConfirmationDialog
                                    open={resetDialogOpen}
                                    onOpenChange={setResetDialogOpen}
                                    onConfirm={resetToDefault}
                                    title="Reset to default flow?"
                                    description="This will deactivate the dynamic config. The system will revert to the hardcoded BM → AM → QCT → Admin flow. Existing members in review are not affected."
                                    confirmText="Reset"
                                    type="warning"
                                    isLoading={saving}
                                />
                            </>
                        )}
                    </div>
                </div>

                {/* Right: Add stage panel */}
                <div className="space-y-4">
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Add Stage</CardTitle>
                            <CardDescription>Choose a role and add it to the workflow.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Role</Label>
                                <Select value={newRoleSlug} onValueChange={setNewRoleSlug}>
                                    <SelectTrigger className="h-9 text-sm">
                                        <SelectValue placeholder="Select role..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableRoles.map(role => (
                                            <SelectItem key={role.slug} value={role.slug}>
                                                <div className="flex items-center gap-2">
                                                    <div
                                                        className="w-2 h-2 rounded-full flex-shrink-0"
                                                        style={{ backgroundColor: getStageColor(role.slug, role.color) }}
                                                    />
                                                    {role.name}
                                                    {role.isSubAdmin && (
                                                        <span className="text-[10px] font-semibold uppercase text-amber-600">Sub Admin</span>
                                                    )}
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Stage Name <span className="text-slate-400">(optional)</span></Label>
                                <Input
                                    className="h-9 text-sm"
                                    placeholder="e.g. Background Check"
                                    value={newStageName}
                                    onChange={e => setNewStageName(e.target.value)}
                                />
                            </div>
                            <Button
                                onClick={addStage}
                                disabled={!newRoleSlug}
                                className="w-full gap-2 h-9"
                                variant="outline"
                            >
                                <Plus className="h-4 w-4" />
                                Add Stage
                            </Button>
                        </CardContent>
                    </Card>

                    {/* Info card */}
                    <Card className="bg-green-50 dark:bg-brand-green-darker/50 border-primary/20 dark:border-sidebar-accent">
                        <CardContent className="pt-4 space-y-2">
                            <div className="flex items-start gap-2">
                                <AlertCircle className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                                <div className="text-xs text-slate-500 space-y-1">
                                    <p>Changes apply to <strong>new enrollments</strong> only.</p>
                                    <p>Members already in review continue with their current stage.</p>
                                    <p>Maximum <strong>5 middle stages</strong> allowed.</p>
                                    <p>Each role can only appear <strong>once</strong> in the workflow.</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Role legend */}
                    {stages.length > 0 && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-xs text-slate-500 uppercase tracking-wider">
                                    Current Stages
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {stages.map((s) => (
                                    <div key={s.id} className="flex items-center gap-2 text-xs">
                                        <div
                                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                            style={{ backgroundColor: getStageColor(s.roleSlug, s.roleColor) }}
                                        />
                                        <span className="font-medium text-sidebar-accent dark:text-slate-300">
                                            Level {s.levelOrder}
                                        </span>
                                        <ChevronRight className="h-3 w-3 text-slate-400" />
                                        <span className="text-slate-500 truncate">{s.stageName}</span>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
}

function FixedStageNode({ label, sublabel, color, icon }: {
    label: string;
    sublabel: string;
    color: string;
    icon: React.ReactNode;
}) {
    return (
        <div
            className="flex items-center gap-3 rounded-lg p-3 border"
            style={{ borderColor: color + '40', backgroundColor: color + '10' }}
        >
            <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white flex-shrink-0"
                style={{ backgroundColor: color }}
            >
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm" style={{ color }}>{label}</p>
                <p className="text-xs text-slate-500">{sublabel}</p>
            </div>
            <Badge variant="outline" className="text-xs flex-shrink-0" style={{ borderColor: color, color }}>
                Fixed
            </Badge>
        </div>
    );
}

function FlowArrow() {
    return (
        <div className="flex justify-center">
            <ArrowDown className="h-5 w-5 text-slate-300 dark:text-sidebar-accent" />
        </div>
    );
}
