'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Reorder, motion, AnimatePresence } from 'framer-motion';
import {
    GripVertical, Plus, Trash2, Save, Loader2, AlertTriangle, ShieldCheck,
    CheckCircle2, RotateCcw, AlertCircle, ChevronRight, Users, Sparkles, Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { PageLoader } from '@/components/ui/page-loader';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { cn } from '@/lib/utils';
import { usePermission } from '@/app/hooks/usePermission';
import { DEFAULT_WORKFLOWS } from '@/app/lib/approval/default-workflows';

// ─── Types ──────────────────────────────────────────────────────
interface RoleOption { id: string; name: string; slug: string; color?: string | null }
interface WorkflowListItem {
    id: string; name: string; isDefault: boolean; isActive: boolean;
    module: { name: string; slug: string };
    _count: { instances: number };
}
interface StageResponse {
    id: string;
    name: string;
    stageOrder: number;
    approverRoleSlug: string;
    allowedActions: string[];
}
interface StageDraft {
    uid: string;       // local key, stable across renders
    id?: string;        // present only for a stage that already exists in the DB
    name: string;
    approverRoleSlug: string;
    allowedActions: string[];
}

const ACTION_OPTIONS = [
    { key: 'approve', label: 'Approve' },
    { key: 'reject', label: 'Reject' },
    { key: 'send_back', label: 'Send Back' },
    { key: 'request_info', label: 'Request Info' },
];

const FALLBACK_COLOR = '#6b7280';

// Every stage must allow 'approve' (the API rejects a stage without it — a
// request could never move past that stage), so the toggle is locked on.
const LOCKED_ACTION = 'approve';

// What a finished chain actually does, and which permission an approver role
// needs on top of being a stage here (the API checks that permission first).
const MODULE_HINTS: Record<string, string> = {
    'hr-onboarding': 'After the last level approves, the employee ID and login are created. Approver roles need HR Onboarding → Approve.',
    'hr-transfer': 'After the last level approves, the employee is moved to the new branch or department. Approver roles need HR Transfer → Approve.',
    'hr-confirmation': 'After the last level approves, the probation confirmation is recorded and the letter is issued. Approver roles need HR Confirmation → Approve.',
    'hr-leave': 'After the last level approves, the leave is marked on attendance and deducted from the balance. Approver roles need HR Leave → Approve.',
    'hr-permission': 'After the last level approves, the permission is granted. Approver roles need HR Leave → Approve.',
    'hr-promotion': 'After the last level approves, the designation is changed and the promotion letter is generated. Approver roles need HR Promotion → Approve.',
    'hr-exit': 'Starts once every clearance item is cleared. After the last level approves, the employee is deactivated and the relieving letter is issued. Approver roles need HR Exit → Approve.',
};

let uidCounter = 0;
function nextUid() { return `stage-${++uidCounter}-${Date.now()}`; }

// Sibling/legacy endpoints (modules list, roles list, workflow list) predate
// the successResponse() convention and return their payload at the top level
// instead of nested under `data` — cast locally rather than fight the type.
async function fetchRaw<T>(path: string): Promise<T> {
    const res = await apiClient.get<unknown>(path);
    return res as unknown as T;
}

export function ApprovalWorkflowConfigPage() {
    const { toast } = useToast();
    const { can } = usePermission();

    const [loading, setLoading] = useState(true);
    const [roles, setRoles] = useState<RoleOption[]>([]);
    const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
    const [selectedModuleSlug, setSelectedModuleSlug] = useState<string>('');
    const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('');

    const [detailLoading, setDetailLoading] = useState(false);
    const [inFlightCount, setInFlightCount] = useState(0);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [isDefault, setIsDefault] = useState(false);
    const [isActive, setIsActive] = useState(true);
    const [stages, setStages] = useState<StageDraft[]>([]);
    const [saving, setSaving] = useState(false);

    const [newWorkflowName, setNewWorkflowName] = useState('');
    const [creating, setCreating] = useState(false);
    const [isBootstrapping, setIsBootstrapping] = useState(false);

    // ── Delete whole workflow ──
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deletingWorkflow, setDeletingWorkflow] = useState(false);

    // "Add Stage" panel
    const [newStageRoleSlug, setNewStageRoleSlug] = useState('');
    const [newStageName, setNewStageName] = useState('');
    const [newStageActions, setNewStageActions] = useState<string[]>(['approve', 'reject']);

    // "Edit Stage" dialog — edits a draft copy, applied to the list on Apply.
    const [editingStage, setEditingStage] = useState<StageDraft | null>(null);

    // ── Load roles / workflow list ─────────────────────────────────
    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const [rolesRes, workflowsRes] = await Promise.all([
                fetchRaw<{ success: boolean; roles: RoleOption[] }>('/admin/roles'),
                fetchRaw<{ success: boolean; workflows: WorkflowListItem[] }>('/admin/approval-workflows'),
            ]);
            if (rolesRes.success) setRoles(rolesRes.roles ?? []);
            if (workflowsRes.success) setWorkflows(workflowsRes.workflows ?? []);
        } catch {
            toast({ title: 'Failed to load data', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => { loadAll(); }, [loadAll]);

    // Tabs are derived from the Module catalog (DEFAULT_WORKFLOWS) — ensuring
    // all seven HR approval tabs render even if a module doesn't have a workflow yet.
    const moduleTabs = useMemo(() => {
        return DEFAULT_WORKFLOWS.map((dw) => {
            const existingWf = workflows.find((w) => w.module.slug === dw.moduleSlug);
            return {
                slug: dw.moduleSlug,
                name: existingWf?.module.name || dw.moduleName,
            };
        });
    }, [workflows]);

    // Auto-select first tab if current selection is invalid
    useEffect(() => {
        if (moduleTabs.length === 0) {
            setSelectedModuleSlug('');
            return;
        }
        if (!moduleTabs.some((m) => m.slug === selectedModuleSlug)) {
            setSelectedModuleSlug(moduleTabs[0].slug);
        }
    }, [moduleTabs, selectedModuleSlug]);

    // Workflows belonging to currently selected module
    const currentModuleWorkflows = useMemo(
        () => workflows.filter((w) => w.module.slug === selectedModuleSlug),
        [workflows, selectedModuleSlug]
    );
    const moduleWorkflows = currentModuleWorkflows;

    // Auto-select first workflow in current module
    useEffect(() => {
        if (currentModuleWorkflows.length === 0) {
            setSelectedWorkflowId('');
            return;
        }
        if (!currentModuleWorkflows.some((w) => w.id === selectedWorkflowId)) {
            const def = currentModuleWorkflows.find((w) => w.isDefault);
            setSelectedWorkflowId((def ?? currentModuleWorkflows[0]).id);
        }
    }, [currentModuleWorkflows, selectedWorkflowId]);

    const roleColor = useCallback(
        (slug: string) => roles.find((r) => r.slug === slug)?.color ?? FALLBACK_COLOR,
        [roles]
    );
    const roleName = useCallback(
        (slug: string) => roles.find((r) => r.slug === slug)?.name ?? slug,
        [roles]
    );

    // ── Load workflow detail when selectedWorkflowId changes ───────
    const loadDetail = useCallback(async (wfId: string) => {
        if (!wfId) return;
        setDetailLoading(true);
        try {
            // Unlike the list/create endpoint (fetchRaw's usual flat {success,
            // workflows} shape), this one route uses successResponse() and
            // nests its payload under `data` — {success, data: {workflow,
            // inFlightCount}}. Reading `res.workflow` directly (as this used
            // to) is always undefined, so the stage list silently never
            // populates on load.
            const res = await fetchRaw<{
                success: boolean;
                data: {
                    workflow: {
                        id: string;
                        name: string;
                        description: string | null;
                        isDefault: boolean;
                        isActive: boolean;
                        stages: StageResponse[];
                    };
                    inFlightCount: number;
                };
            }>(`/admin/approval-workflows/${wfId}`);
            if (res.success && res.data?.workflow) {
                const w = res.data.workflow;
                setName(w.name);
                setDescription(w.description ?? '');
                setIsDefault(w.isDefault);
                setIsActive(w.isActive);
                setInFlightCount(res.data.inFlightCount ?? 0);
                setStages(
                    (w.stages ?? [])
                        .sort((a, b) => a.stageOrder - b.stageOrder)
                        .map((s): StageDraft => ({
                            uid: nextUid(),
                            id: s.id,
                            name: s.name,
                            approverRoleSlug: s.approverRoleSlug,
                            allowedActions: s.allowedActions?.includes(LOCKED_ACTION)
                                ? s.allowedActions
                                : [LOCKED_ACTION, ...(s.allowedActions ?? ['reject'])],
                        }))
                );
            }
        } catch {
            toast({ title: 'Failed to load workflow details', variant: 'destructive' });
        } finally {
            setDetailLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        if (selectedWorkflowId) loadDetail(selectedWorkflowId);
        else { setStages([]); setInFlightCount(0); }
    }, [selectedWorkflowId, loadDetail]);

    // ── Stage editing helpers ──────────────────────────────────────
    const removeStage = (uid: string) => setStages((prev) => prev.filter((s) => s.uid !== uid));

    const addStage = () => {
        if (!newStageRoleSlug) return;
        const role = roles.find((r) => r.slug === newStageRoleSlug);
        if (!role) return;
        setStages((prev) => [...prev, {
            uid: nextUid(),
            name: newStageName.trim() || `${role.name} Review`,
            approverRoleSlug: newStageRoleSlug,
            allowedActions: newStageActions,
        }]);
        setNewStageRoleSlug('');
        setNewStageName('');
        setNewStageActions(['approve', 'reject']);
    };

    const toggleAction = (actions: string[], action: string) => {
        if (action === LOCKED_ACTION) return actions;
        return actions.includes(action) ? actions.filter((a) => a !== action) : [...actions, action];
    };
    const toggleNewStageAction = (action: string) => setNewStageActions((prev) => toggleAction(prev, action));

    const applyStageEdit = () => {
        if (!editingStage) return;
        if (!editingStage.name.trim()) {
            toast({ title: 'Stage name is required', variant: 'destructive' });
            return;
        }
        setStages((prev) => prev.map((s) => (s.uid === editingStage.uid ? { ...editingStage, name: editingStage.name.trim() } : s)));
        setEditingStage(null);
    };

    // Roles already used in the current stage list — hidden from the "Add
    // Stage" picker so the same role isn't accidentally added twice.
    const usedSlugs = useMemo(() => new Set(stages.map((s) => s.approverRoleSlug)), [stages]);
    const availableRoles = useMemo(() => roles.filter((r) => !usedSlugs.has(r.slug)), [roles, usedSlugs]);
    // Same rule for the edit dialog, but the stage being edited keeps its own role.
    const editableRoles = useMemo(
        () => roles.filter((r) => !usedSlugs.has(r.slug) || r.slug === stages.find((s) => s.uid === editingStage?.uid)?.approverRoleSlug),
        [roles, usedSlugs, stages, editingStage?.uid]
    );
    const canEdit = can('admin', 'edit');

    // ── Create a brand-new workflow for the selected module ────────
    const handleCreateWorkflow = async () => {
        if (!newWorkflowName.trim()) {
            toast({ title: 'Name required', variant: 'destructive' });
            return;
        }
        setCreating(true);
        try {
            // POST /admin/approval-workflows also predates successResponse() and
            // returns { success, workflow } at the top level, not under `data` —
            // only `.success`/`.error` are read below, which line up either way.
            const postRes = await apiClient.post<unknown>('/admin/approval-workflows', {
                moduleSlug: selectedModuleSlug,
                name: newWorkflowName.trim(),
                isDefault: moduleWorkflows.length === 0,
                stages: [{ name: 'Approval', stageOrder: 1, approverRoleSlug: 'admin', allowedActions: ['approve', 'reject'] }],
            });
            if (postRes.success) {
                toast({ title: 'Workflow created' });
                setNewWorkflowName('');
                await loadAll();
            } else {
                toast({ title: postRes.error ?? 'Failed to create workflow', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Network error', variant: 'destructive' });
        } finally {
            setCreating(false);
        }
    };

    // Standard approval types that have no workflow in the database yet.
    const missingDefaults = useMemo(
        () => DEFAULT_WORKFLOWS.filter((d) => !workflows.some((w) => w.module.slug === d.moduleSlug)),
        [workflows]
    );

    // ── Bootstrap a default workflow for a specific module ──
    const handleCreateDefaultWorkflowForModule = async (moduleSlug: string) => {
        const wf = DEFAULT_WORKFLOWS.find((d) => d.moduleSlug === moduleSlug);
        if (!wf) return;
        setIsBootstrapping(true);
        try {
            const res = await apiClient.post<{ success: boolean; workflow: unknown }>('/admin/approval-workflows', wf);
            if (res.success) {
                toast({
                    title: 'Workflow created',
                    description: `${wf.name} created successfully.`,
                });
                await loadAll();
            } else {
                toast({
                    title: 'Failed to create workflow',
                    description: res.error || `Failed to create ${wf.name}`,
                    variant: 'destructive',
                });
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Network error';
            toast({
                title: 'Error',
                description: message,
                variant: 'destructive',
            });
        } finally {
            setIsBootstrapping(false);
        }
    };

    // ── Bootstrap canonical default workflows (only the missing ones) ──
    const handleCreateDefaultWorkflows = async () => {
        setIsBootstrapping(true);
        try {
            for (const wf of missingDefaults) {
                const res = await apiClient.post<{ success: boolean; workflow: unknown }>('/admin/approval-workflows', wf);
                if (res.success) {
                    toast({
                        title: 'Workflow created',
                        description: `${wf.name} created successfully.`,
                    });
                } else {
                    toast({
                        title: 'Failed to create workflow',
                        description: res.error || `Failed to create ${wf.name}`,
                        variant: 'destructive',
                    });
                }
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Network error';
            toast({
                title: 'Error',
                description: message,
                variant: 'destructive',
            });
        } finally {
            await loadAll();
            setIsBootstrapping(false);
        }
    };

    // ── Save ─────────────────────────────────────────────────────
    const handleSave = async () => {
        if (stages.length === 0) {
            toast({ title: 'Add at least one stage', variant: 'destructive' });
            return;
        }
        if (!name.trim()) {
            toast({ title: 'Workflow name is required', variant: 'destructive' });
            return;
        }
        for (let i = 0; i < stages.length; i++) {
            const s = stages[i];
            const stageLabel = s.name.trim() || `Stage ${i + 1}`;
            if (!s.name.trim()) {
                toast({ title: `Stage ${i + 1} needs a name`, variant: 'destructive' });
                return;
            }
            if (!s.approverRoleSlug) {
                toast({ title: `"${stageLabel}" needs an approver role`, variant: 'destructive' });
                return;
            }
            if (s.allowedActions.length === 0) {
                toast({ title: `"${stageLabel}" needs at least one allowed action`, variant: 'destructive' });
                return;
            }
        }
        setSaving(true);
        try {
            const payload = {
                name,
                description: description || null,
                isDefault,
                isActive,
                stages: stages.map((s, idx) => ({
                    id: s.id,
                    name: s.name,
                    stageOrder: idx + 1,
                    approverRoleSlug: s.approverRoleSlug,
                    allowedActions: s.allowedActions,
                })),
            };
            const res = await apiClient.put<{ workflow: { id: string; stages: StageResponse[] } }>(
                `/admin/approval-workflows/${selectedWorkflowId}`,
                payload
            );
            if (res.success) {
                toast({ title: 'Saved', description: 'New requests will follow this order.' });
                await loadDetail(selectedWorkflowId);
                await loadAll();
            } else {
                toast({ title: res.error ?? 'Failed to save workflow', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Network error', variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    // ── Delete the whole workflow — server decides hard-delete (never used)
    // vs. soft-delete/deactivate (has request history); its message is toasted
    // verbatim either way. ──
    const handleDeleteWorkflow = async () => {
        if (!selectedWorkflowId) return;
        setDeletingWorkflow(true);
        try {
            const res = await apiClient.delete<null>(`/admin/approval-workflows/${selectedWorkflowId}`);
            if (res.success) {
                toast({ title: res.message ?? 'Workflow deleted' });
                setDeleteDialogOpen(false);
                setSelectedWorkflowId('');
                await loadAll();
            } else {
                toast({ title: res.error ?? 'Failed to delete workflow', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Network error', variant: 'destructive' });
        } finally {
            setDeletingWorkflow(false);
        }
    };

    if (loading) return <PageLoader fullScreen={false} />;

    // Mirrors the backend's own in-flight block on PUT (route.ts) — the
    // server rejects a save outright while any instance is non-terminal, so
    // the UI must be honest about that rather than implying stages can still
    // be edited "moving forward" while requests are in progress.
    const editLocked = inFlightCount > 0;
    // Saved (not locally toggled) state — what the engine actually uses now.
    const savedWorkflow = workflows.find((w) => w.id === selectedWorkflowId);

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-foreground dark:text-slate-100 flex items-center gap-2">
                    <ShieldCheck className="h-6 w-6 text-primary" /> Approval Settings
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                    Configure the approval chain for any HR workflow — any number of stages, any role, in any order.
                    Drag stages to reorder. Changes apply to new requests only.
                </p>
            </div>

            {/* ── Module tabs — one per module that already has a workflow ── */}
            {moduleTabs.length > 0 && (
                <Tabs value={selectedModuleSlug} onValueChange={setSelectedModuleSlug}>
                    <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
                        {moduleTabs.map((m) => (
                            <TabsTrigger key={m.slug} value={m.slug} className="flex-none">{m.name}</TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            )}

            {MODULE_HINTS[selectedModuleSlug] && (
                <p className="text-xs text-slate-500 -mt-3">{MODULE_HINTS[selectedModuleSlug]}</p>
            )}

            {selectedModuleSlug && moduleWorkflows.length > 1 && (
                <div className="max-w-xs">
                    <Label className="mb-1.5 block text-xs text-gray-500">Workflow</Label>
                    <Select value={selectedWorkflowId} onValueChange={setSelectedWorkflowId}>
                        <SelectTrigger><SelectValue placeholder="Choose a workflow" /></SelectTrigger>
                        <SelectContent>
                            {moduleWorkflows.map((w) => (
                                <SelectItem key={w.id} value={w.id}>
                                    {w.name} {w.isDefault ? '(default)' : ''}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

            {/* ── Empty state + bootstrap for module with zero workflows ── */}
            {selectedModuleSlug && moduleWorkflows.length === 0 && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3">
                        <Users className="h-4 w-4 flex-shrink-0" />
                        No approval workflow configured for this module yet.
                    </div>
                    {can('admin', 'create') && (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-white dark:bg-brand-green-darker border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm">
                            <p className="text-sm text-slate-600 dark:text-slate-300">
                                No approval chain is set up yet for{' '}
                                <span className="font-medium">
                                    {DEFAULT_WORKFLOWS.find((d) => d.moduleSlug === selectedModuleSlug)?.moduleName ?? selectedModuleSlug}
                                </span>.
                                Add the default single-stage Admin approval workflow to get started.
                            </p>
                            <Button
                                onClick={() => handleCreateDefaultWorkflowForModule(selectedModuleSlug)}
                                disabled={isBootstrapping}
                                className="bg-primary text-white flex-shrink-0"
                            >
                                {isBootstrapping ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                    <Sparkles className="h-4 w-4 mr-2" />
                                )}
                                {isBootstrapping ? 'Creating workflow...' : 'Create default workflow'}
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {/* ── Add an alternate (non-default) workflow to the selected module ── */}
            {/* New requests always use the module's default workflow
                (app/lib/approval/engine.ts), so an alternate one is a prepared
                chain that takes over only once it's marked default. */}
            {selectedModuleSlug && moduleWorkflows.length > 0 && can('admin', 'create') && (
                <Card className="border-dashed">
                    <CardContent className="pt-6 space-y-3">
                        <div className="space-y-1">
                            <p className="text-sm text-gray-600">Prepare an alternate approval chain for this module.</p>
                            <p className="text-xs text-slate-500">
                                New requests always follow the <strong>default</strong> workflow. An alternate workflow is only
                                used after you switch <strong>Default for module</strong> on for it.
                            </p>
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                            <div className="flex-1 sm:max-w-sm">
                                <Label className="mb-1.5 block text-xs text-gray-500">Workflow name</Label>
                                <Input value={newWorkflowName} onChange={(e) => setNewWorkflowName(e.target.value)}
                                    placeholder="e.g. Fast-Track Approval" />
                            </div>
                            <Button onClick={handleCreateWorkflow} disabled={creating} variant="outline" className="gap-2">
                                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                Add Workflow
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* ── Workflow editor ── */}
            {selectedWorkflowId && (
                detailLoading ? <PageLoader fullScreen={false} /> : (
                    <>
                        {editLocked ? (
                            <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2">
                                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                                Editing is temporarily locked because {inFlightCount} request(s) are currently in progress.
                                Complete those requests before editing this workflow, or create a new workflow.
                            </div>
                        ) : savedWorkflow && !savedWorkflow.isActive ? (
                            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-2">
                                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                This workflow is <strong>inactive</strong> — no requests use it.
                            </div>
                        ) : savedWorkflow && !savedWorkflow.isDefault ? (
                            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-2">
                                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                This is an <strong>alternate</strong> workflow — new requests use the default one until you mark this as default.
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg px-4 py-2">
                                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                                This is the <strong>default</strong> workflow. New requests follow the order below.
                            </div>
                        )}

                        <div className="flex flex-wrap items-end gap-4">
                            <div className="flex-1 min-w-[200px]">
                                <Label className="mb-1.5 block text-xs text-gray-500">Workflow Name</Label>
                                <Input value={name} onChange={(e) => setName(e.target.value)} />
                            </div>
                            <div className="flex-1 min-w-[200px]">
                                <Label className="mb-1.5 block text-xs text-gray-500">Description</Label>
                                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
                            </div>
                            <div className="flex items-center gap-2 pb-2">
                                <Switch checked={isDefault} onCheckedChange={setIsDefault} />
                                <Label className="text-sm whitespace-nowrap">Default for module</Label>
                            </div>
                            <div className="flex items-center gap-2 pb-2">
                                <Switch checked={isActive} onCheckedChange={setIsActive} />
                                <Label className="text-sm">Active</Label>
                            </div>
                            {can('admin', 'delete') && (
                                <div className="pb-2">
                                    <Button
                                        variant="outline"
                                        className="gap-2 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:border-red-900 dark:hover:bg-red-950/30"
                                        onClick={() => setDeleteDialogOpen(true)}
                                    >
                                        <Trash2 className="h-4 w-4" /> Delete Workflow
                                    </Button>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* ── Left: flow visualization ── */}
                            <div className="lg:col-span-2 space-y-4">
                                <Card>
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-base">Approval Flow</CardTitle>
                                        <CardDescription>Drag stages to reorder.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                        {stages.length === 0 ? (
                                            <div className="border-2 border-dashed border-primary/20 dark:border-sidebar-accent rounded-lg p-6 text-center text-slate-400 text-sm">
                                                No stages configured. Add one from the panel →
                                            </div>
                                        ) : (
                                            <Reorder.Group axis="y" values={stages} onReorder={setStages} className="space-y-2">
                                                <AnimatePresence>
                                                    {stages.map((stage, idx) => (
                                                        <Reorder.Item
                                                            key={stage.uid} value={stage}
                                                            dragListener
                                                            className="cursor-grab active:cursor-grabbing"
                                                        >
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
                                                                    style={{ backgroundColor: roleColor(stage.approverRoleSlug) }}
                                                                >
                                                                    {idx + 1}
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="font-medium text-sm text-foreground dark:text-slate-100 truncate">
                                                                        {stage.name}
                                                                    </p>
                                                                    <p className="text-xs text-slate-500 truncate">{roleName(stage.approverRoleSlug)}</p>
                                                                </div>
                                                                <div className="hidden sm:flex items-center gap-1 flex-wrap flex-shrink-0">
                                                                    {ACTION_OPTIONS.filter((a) => stage.allowedActions.includes(a.key)).map((a) => (
                                                                        <Badge key={a.key} variant="outline" className="text-[10px] px-1.5 py-0">
                                                                            {a.label}
                                                                        </Badge>
                                                                    ))}
                                                                </div>
                                                                <Badge
                                                                    variant="outline"
                                                                    className="text-xs flex-shrink-0"
                                                                    style={{ borderColor: roleColor(stage.approverRoleSlug), color: roleColor(stage.approverRoleSlug) }}
                                                                >
                                                                    Level {idx + 1}
                                                                </Badge>
                                                                <Button
                                                                    variant="ghost" size="icon"
                                                                    className="h-7 w-7 text-slate-400 hover:text-primary flex-shrink-0"
                                                                    onClick={() => setEditingStage({ ...stage, allowedActions: [...stage.allowedActions] })}
                                                                    title="Edit stage"
                                                                >
                                                                    <Pencil className="h-3.5 w-3.5" />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost" size="icon"
                                                                    className="h-7 w-7 text-slate-400 hover:text-red-500 flex-shrink-0"
                                                                    onClick={() => removeStage(stage.uid)}
                                                                    title="Remove stage (local draft — Save to apply)"
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </Button>
                                                            </motion.div>
                                                        </Reorder.Item>
                                                    ))}
                                                </AnimatePresence>
                                            </Reorder.Group>
                                        )}
                                    </CardContent>
                                </Card>

                                {canEdit ? (
                                <div className="flex items-center gap-3">
                                    <Button
                                        onClick={handleSave}
                                        disabled={saving || editLocked || stages.length === 0}
                                        title={editLocked ? `Locked — ${inFlightCount} request(s) in progress` : undefined}
                                        className="gap-2"
                                    >
                                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                        Save Workflow
                                    </Button>
                                    <Button variant="outline" className="gap-2" onClick={() => loadDetail(selectedWorkflowId)} disabled={saving}>
                                        <RotateCcw className="h-4 w-4" /> Discard Changes
                                    </Button>
                                </div>
                                ) : (
                                    <p className="text-xs text-slate-500">You have view-only access — changes here can&apos;t be saved.</p>
                                )}
                            </div>

                            {/* ── Right: add-stage panel ── */}
                            <div className="space-y-4">
                                <Card>
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-base">Add Stage</CardTitle>
                                        <CardDescription>Choose a role and add it to the workflow.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        <div className="space-y-1.5">
                                            <Label className="text-xs">Role</Label>
                                            <Select value={newStageRoleSlug} onValueChange={setNewStageRoleSlug}>
                                                <SelectTrigger className="h-9 text-sm">
                                                    <SelectValue placeholder="Select role..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {availableRoles.map((role) => (
                                                        <SelectItem key={role.slug} value={role.slug}>
                                                            <div className="flex items-center gap-2">
                                                                <div
                                                                    className="w-2 h-2 rounded-full flex-shrink-0"
                                                                    style={{ backgroundColor: role.color ?? FALLBACK_COLOR }}
                                                                />
                                                                {role.name}
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
                                                placeholder="e.g. Branch Manager Review"
                                                value={newStageName}
                                                onChange={(e) => setNewStageName(e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-xs">Allowed Actions</Label>
                                            <ActionToggles selected={newStageActions} onToggle={toggleNewStageAction} />
                                        </div>
                                        <Button
                                            onClick={addStage}
                                            disabled={!newStageRoleSlug}
                                            className="w-full gap-2 h-9"
                                            variant="outline"
                                        >
                                            <Plus className="h-4 w-4" />
                                            Add Stage
                                        </Button>
                                    </CardContent>
                                </Card>

                                <Card className="bg-green-50 dark:bg-brand-green-darker/50 border-primary/20 dark:border-sidebar-accent">
                                    <CardContent className="pt-4 space-y-2">
                                        <div className="flex items-start gap-2">
                                            <AlertCircle className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                                            <div className="text-xs text-slate-500 space-y-1">
                                                <p>Changes apply to <strong>new requests</strong> only.</p>
                                                <p>Saving is blocked while any request is still in approval on this workflow — finish those requests first.</p>
                                                <p>A stage that past requests went through can&apos;t be removed (it keeps their approval history) — edit its name or role instead.</p>
                                                <p>Every stage always allows Approve.</p>
                                                <p>No limit on stage count — add as many as you need.</p>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>

                                {stages.length > 0 && (
                                    <Card>
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-xs text-slate-500 uppercase tracking-wider">
                                                Current Stages
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-2">
                                            {stages.map((s, idx) => (
                                                <div key={s.uid} className="flex items-center gap-2 text-xs">
                                                    <div
                                                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                                        style={{ backgroundColor: roleColor(s.approverRoleSlug) }}
                                                    />
                                                    <span className="font-medium text-sidebar-accent dark:text-slate-300">
                                                        Level {idx + 1}
                                                    </span>
                                                    <ChevronRight className="h-3 w-3 text-slate-400" />
                                                    <span className="text-slate-500 truncate">{s.name}</span>
                                                </div>
                                            ))}
                                        </CardContent>
                                    </Card>
                                )}
                            </div>
                        </div>
                    </>
                )
            )}

            {(moduleTabs.length === 0 || missingDefaults.length > 0) && (
                <div className="space-y-4">
                    {moduleTabs.length === 0 && (
                        <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                            <Users className="h-4 w-4 flex-shrink-0" />
                            No module has an approval workflow configured yet.
                        </div>
                    )}
                    {can('admin', 'create') && missingDefaults.length > 0 && (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-white border border-slate-200 rounded-lg shadow-sm">
                            <p className="text-sm text-slate-600">
                                No approval chain is set up yet for{' '}
                                <span className="font-medium">{missingDefaults.map((d) => d.moduleName).join(', ')}</span>.
                                Add them now — each starts as a single Admin approval that you can then extend.
                            </p>
                            <Button
                                onClick={handleCreateDefaultWorkflows}
                                disabled={isBootstrapping}
                                className="bg-primary text-white flex-shrink-0"
                            >
                                {isBootstrapping ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                    <Sparkles className="h-4 w-4 mr-2" />
                                )}
                                {isBootstrapping ? 'Adding workflows...' : 'Add default workflows'}
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {/* ── Edit stage (local draft — applied on Save Workflow) ── */}
            <Dialog open={!!editingStage} onOpenChange={(open) => { if (!open) setEditingStage(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader><DialogTitle>Edit Stage</DialogTitle></DialogHeader>
                    {editingStage && (
                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Stage Name</Label>
                                <Input
                                    value={editingStage.name}
                                    onChange={(e) => setEditingStage({ ...editingStage, name: e.target.value })}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Approver Role</Label>
                                <Select
                                    value={editingStage.approverRoleSlug}
                                    onValueChange={(v) => setEditingStage({ ...editingStage, approverRoleSlug: v })}
                                >
                                    <SelectTrigger><SelectValue placeholder="Select role..." /></SelectTrigger>
                                    <SelectContent>
                                        {editableRoles.map((role) => (
                                            <SelectItem key={role.slug} value={role.slug}>
                                                <div className="flex items-center gap-2">
                                                    <div
                                                        className="w-2 h-2 rounded-full flex-shrink-0"
                                                        style={{ backgroundColor: role.color ?? FALLBACK_COLOR }}
                                                    />
                                                    {role.name}
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Allowed Actions</Label>
                                <ActionToggles
                                    selected={editingStage.allowedActions}
                                    onToggle={(action) => setEditingStage({
                                        ...editingStage,
                                        allowedActions: toggleAction(editingStage.allowedActions, action),
                                    })}
                                />
                            </div>
                            <p className="text-xs text-slate-500">Click Save Workflow afterwards to apply this change.</p>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingStage(null)}>Cancel</Button>
                        <Button onClick={applyStageEdit}>Apply</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Delete workflow confirmation ── */}
            <Dialog open={deleteDialogOpen} onOpenChange={(open) => { if (!open && !deletingWorkflow) setDeleteDialogOpen(false); }}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Delete Workflow</DialogTitle></DialogHeader>
                    <p className="text-sm text-slate-600">
                        Delete <span className="font-medium">{name}</span>? If it has never been used, it will be permanently
                        deleted; if it has request history, it will be deactivated instead of deleted.
                    </p>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deletingWorkflow}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleDeleteWorkflow} disabled={deletingWorkflow}>
                            {deletingWorkflow ? 'Deleting...' : 'Delete'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function ActionToggles({ selected, onToggle }: { selected: string[]; onToggle: (action: string) => void }) {
    return (
        <div className="flex flex-wrap gap-1.5">
            {ACTION_OPTIONS.map((a) => {
                const locked = a.key === LOCKED_ACTION;
                const on = locked || selected.includes(a.key);
                return (
                    <button
                        key={a.key}
                        type="button"
                        onClick={() => onToggle(a.key)}
                        disabled={locked}
                        title={locked ? 'Every stage must allow Approve' : undefined}
                        className={cn(
                            'text-xs px-2 py-1 rounded-full border transition-colors',
                            on
                                ? 'bg-primary text-white border-primary'
                                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300 dark:bg-transparent dark:border-slate-700',
                            locked && 'cursor-not-allowed opacity-80'
                        )}
                    >
                        {a.label}
                    </button>
                );
            })}
        </div>
    );
}
