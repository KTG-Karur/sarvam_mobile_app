'use client';

import { useState, useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Loader2,
    UsersRound,
    RotateCcw,
    CheckCircle2,
    Users,
    AlertCircle,
    UserPlus,
    Building2,
    Search,
} from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { getPersonLabel } from '@/app/lib/person-label';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { cn } from '@/lib/utils';

import { matchesMemberSearch } from '@/app/lib/reports/member-contact-columns';
// ─── Types ────────────────────────────────────────────────────────────────────

type Center = { id: string; name: string; code: string };
type Group  = { id: string; name: string; memberCount: number; maxMembersPerGroup: number };

type Client = {
    id: string;
    clientId: string;
    firstName: string;
    lastName: string;
    phone?: string | null;
    otherIdNo?: string | null;
    mobileNumber?: string | null;
    spouseName?: string | null;
    groupId?: string | null;
    centerId?: string | null;
    /** Has at least one Loan record (any status) — false means still a Member, not yet a Client */
    hasLoan?: boolean;
    /** FDO's group request from enrollment — request only, not a real assignment */
    memberGroupStatus?: string | null;
    requestedCenterId?: string | null;
    requestedCenterName?: string | null;
    requestedGroupId?: string | null;
    requestedGroupName?: string | null;
};

const MEMBER_GROUP_STATUS_LABELS: Record<string, string> = {
    NEW_CENTER_NEW_MEMBER: 'New Center New Member',
    EXISTING_CENTER_NEW_MEMBER: 'Existing Center New Member',
};

type ClientAssignment = { clientId: string; groupId: string };

/** Per-row state for the "assign center" tab — both center and group are picked manually */
type NewClientAssignment = {
    clientDbId: string;
    centerId: string;
    groupId: string;
};

// ─── Validation Schemas ───────────────────────────────────────────────────────

const groupAssignSchema = z.object({
    centerName: z.string().min(1, 'Center name is required'),
});
type GroupAssignFormValues = z.infer<typeof groupAssignSchema>;

// ─── Shared table: unassigned members with per-row Center/Group selectors ─────
// Used by both the Bulk Assign and Individual Assign views — they differ only
// in the search/filtering above the table and in the action column (bulk saves
// all changed rows at once via a button below the table; individual assigns
// one row at a time via `actionColumn`).

type UnassignedClientsTableProps = {
    clients: Client[];
    assignments: Record<string, NewClientAssignment>;
    centers: Center[];
    isLoadingCenters: boolean;
    groupsByCenterId: Record<string, Group[]>;
    loadingGroupsForCenterId: Record<string, boolean>;
    onCenterChange: (clientDbId: string, centerId: string) => void;
    onGroupChange: (clientDbId: string, groupId: string) => void;
    actionColumn?: (client: Client) => React.ReactNode;
};

function UnassignedClientsTable({
    clients,
    assignments,
    centers,
    isLoadingCenters,
    groupsByCenterId,
    loadingGroupsForCenterId,
    onCenterChange,
    onGroupChange,
    actionColumn,
}: UnassignedClientsTableProps) {
    return (
        <div className="overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow className="bg-brand-green-darker text-white hover:bg-brand-green-darker">
                        <TableHead className="text-white font-semibold">Member ID</TableHead>
                        <TableHead className="text-white font-semibold">Name</TableHead>
                        <TableHead className="text-white font-semibold">Mobile</TableHead>
                        <TableHead className="text-white font-semibold">Group Status</TableHead>
                        <TableHead className="text-white font-semibold">Requested Center</TableHead>
                        <TableHead className="text-white font-semibold">Requested Group</TableHead>
                        <TableHead className="text-white font-semibold">Assign Center</TableHead>
                        <TableHead className="text-white font-semibold">Assign Group</TableHead>
                        {actionColumn && <TableHead className="text-white font-semibold">Action</TableHead>}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {clients.map((client, idx) => {
                        const assignment = assignments[client.id] || { clientDbId: client.id, centerId: '', groupId: '' };
                        const fullName = `${client.firstName} ${client.lastName}`.trim();
                        const rowGroups = assignment.centerId ? (groupsByCenterId[assignment.centerId] || []) : [];
                        const isLoadingRowGroups = assignment.centerId ? !!loadingGroupsForCenterId[assignment.centerId] : false;

                        return (
                            <TableRow
                                key={client.id}
                                className={cn(
                                    'transition-colors',
                                    assignment.centerId
                                        ? 'bg-amber-50 dark:bg-amber-950/20 border-l-4 border-l-amber-500'
                                        : idx % 2 === 0
                                        ? 'bg-green-50 dark:bg-brand-green-darker/50'
                                        : 'bg-white dark:bg-sidebar-accent/50'
                                )}
                            >
                                <TableCell className="font-medium text-foreground dark:text-slate-100">
                                    {client.clientId}
                                </TableCell>
                                <TableCell className="text-sidebar-accent dark:text-slate-300">
                                    {fullName || '—'}
                                </TableCell>
                                <TableCell className="text-sidebar-accent dark:text-slate-300">
                                    {client.phone || '—'}
                                </TableCell>
                                <TableCell className="text-sidebar-accent dark:text-slate-300">
                                    {MEMBER_GROUP_STATUS_LABELS[client.memberGroupStatus ?? ''] ?? '—'}
                                </TableCell>
                                <TableCell className="text-sidebar-accent dark:text-slate-300">
                                    {client.requestedCenterName || '—'}
                                </TableCell>
                                <TableCell className="text-sidebar-accent dark:text-slate-300">
                                    {client.requestedGroupName || '—'}
                                </TableCell>

                                {/* Center selector */}
                                <TableCell>
                                    <Select
                                        value={assignment.centerId}
                                        onValueChange={(v) => onCenterChange(client.id, v)}
                                        disabled={isLoadingCenters}
                                    >
                                        <SelectTrigger className={cn('h-9 w-full min-w-[160px]', assignment.centerId && 'border-amber-500 ring-2 ring-amber-500/20')}>
                                            <SelectValue placeholder={isLoadingCenters ? 'Loading…' : 'Select center'} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {centers.map((c) => (
                                                <SelectItem key={c.id} value={c.id}>
                                                    <span className="font-medium">{c.name}</span>{' '}
                                                    <span className="text-muted-foreground">({c.code})</span>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </TableCell>

                                {/* Group selector — only groups with spare capacity in the chosen center */}
                                <TableCell>
                                    <Select
                                        value={assignment.groupId}
                                        onValueChange={(v) => onGroupChange(client.id, v)}
                                        disabled={!assignment.centerId || isLoadingRowGroups}
                                    >
                                        <SelectTrigger className={cn('h-9 w-full min-w-[180px]', assignment.groupId && 'border-amber-500 ring-2 ring-amber-500/20')}>
                                            <SelectValue placeholder={
                                                !assignment.centerId
                                                    ? 'Select center first'
                                                    : isLoadingRowGroups
                                                    ? 'Loading…'
                                                    : 'Select group'
                                            } />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {assignment.centerId && !isLoadingRowGroups && rowGroups.length === 0 ? (
                                                <div className="px-2 py-1.5 text-sm text-muted-foreground max-w-[220px]">
                                                    No groups with available capacity — create one from Centers → Groups.
                                                </div>
                                            ) : (
                                                rowGroups.map((g) => (
                                                    <SelectItem key={g.id} value={g.id}>
                                                        {g.name} ({g.memberCount}/{g.maxMembersPerGroup})
                                                    </SelectItem>
                                                ))
                                            )}
                                        </SelectContent>
                                    </Select>
                                </TableCell>

                                {actionColumn && <TableCell>{actionColumn(client)}</TableCell>}
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GroupAssignClient() {
    const { canPage } = usePermission();
    const canEditClient = canPage('/dashboard/client-operations/group-assign', 'edit');
    const { toast } = useToast();

    // ── Branch filter (shared by both tabs) — Admin sees all branches, Area
    //    Manager scoped to their assigned branches; feeds the shared `centers` list.
    const storedUser = tokenStorage.getUser();
    const isAdminOrAM =
        storedUser?.role === 'ADMIN' ||
        storedUser?.role === 'ADMIN_NON_HO_BRANCH_SWITCH' ||
        storedUser?.role === 'AREA_MANAGER';
    const [branches, setBranches] = useState<Center[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [branchName, setBranchName] = useState('');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    // ── Shared state ──────────────────────────────────────────────────────────
    const [centers, setCenters]               = useState<Center[]>([]);
    const [isLoadingCenters, setIsLoadingCenters] = useState(true);

    // ── Reassign-group tab ────────────────────────────────────────────────────
    const [groups, setGroups]                 = useState<Group[]>([]);
    const [clients, setClients]               = useState<Client[]>([]);
    const [clientAssignments, setClientAssignments] = useState<Record<string, ClientAssignment>>({});
    const [isLoadingGroups, setIsLoadingGroups]     = useState(false);
    const [isLoadingClients, setIsLoadingClients]   = useState(false);
    const [isSubmitting, setIsSubmitting]           = useState(false);
    const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
    const [pendingChanges, setPendingChanges]       = useState(0);

    // ── Client ID / name / phone / Aadhaar search (client-side filter for each tab) ────
    const [reassignSearch, setReassignSearch]     = useState('');
    const [unassignedSearch, setUnassignedSearch] = useState('');

    const matchesSearch = (client: Client, query: string) => {
        return matchesMemberSearch(
            query,
            { aadhaarNumber: client.otherIdNo, mobileNumber: client.mobileNumber || client.phone },
            client.clientId,
            `${client.firstName} ${client.lastName}`,
            client.phone,
        );
    };

    // ── New-client (assign center) tab — center and group are both manual ─────
    const [unassignedClients, setUnassignedClients]               = useState<Client[]>([]);
    // Starts true (not false) — the list now waits on the branch filter to resolve
    // before its first fetch, so this avoids a false "All members are assigned!"
    // flash between mount and that first branch-scoped fetch.
    const [isLoadingUnassigned, setIsLoadingUnassigned]           = useState(true);
    const [newAssignments, setNewAssignments]                     = useState<Record<string, NewClientAssignment>>({});
    const [isSubmittingNew, setIsSubmittingNew]                   = useState(false);
    const [confirmNewDialogOpen, setConfirmNewDialogOpen]         = useState(false);
    // Groups with spare capacity per center, fetched lazily as rows pick a center.
    const [groupsByCenterId, setGroupsByCenterId]                 = useState<Record<string, Group[]>>({});
    const [loadingGroupsForCenterId, setLoadingGroupsForCenterId] = useState<Record<string, boolean>>({});

    // ── "Assign Center" tab — individual (per-row) sub-mode ───────────────────
    // Same table as Bulk Assign, but each row assigns itself immediately via
    // its own button instead of a single "Save Assignments" button for all rows.
    const [individualConfirmClientId, setIndividualConfirmClientId] = useState<string | null>(null);
    const [individualSubmittingId, setIndividualSubmittingId]       = useState<string | null>(null);

    const form = useForm<GroupAssignFormValues>({
        resolver: zodResolver(groupAssignSchema),
        defaultValues: { centerName: '' },
    });

    const selectedCenterId = form.watch('centerName');

    const filteredUnassignedClients = useMemo(
        () => unassignedClients.filter((c) => matchesSearch(c, unassignedSearch)),
        [unassignedClients, unassignedSearch]
    );
    const filteredClients = useMemo(
        () => clients.filter((c) => matchesSearch(c, reassignSearch)),
        [clients, reassignSearch]
    );

    // Client the individual-assign confirm dialog is currently open for (display only)
    const individualConfirmClient = individualConfirmClientId
        ? unassignedClients.find((c) => c.id === individualConfirmClientId) ?? null
        : null;

    // Radix Tabs generates its trigger/content `id`/`aria-controls` pairs via
    // React's useId(), which is only guaranteed stable when the server- and
    // client-rendered trees are structurally identical. Deferring the Tabs
    // render until after mount (client-only) sidesteps hydration-mismatch
    // warnings from anything upstream shifting that tree between SSR and CSR.
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    // ── Load branches on mount ─────────────────────────────────────────────────
    useEffect(() => {
        loadBranches();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Fetch centers, and the unassigned-clients list, whenever the selected
    //    branch changes — both tabs stay scoped to the same "Branch" filter above.
    useEffect(() => {
        if (selectedBranchId) {
            form.setValue('centerName', '');
            setCenters([]);
            fetchCenters(selectedBranchId);
            fetchUnassignedClients(selectedBranchId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedBranchId]);

    // ── When reassign-tab center changes ──────────────────────────────────────
    useEffect(() => {
        if (selectedCenterId) {
            fetchGroups(selectedCenterId);
            fetchClients(selectedCenterId);
        } else {
            setGroups([]);
            setClients([]);
            setClientAssignments({});
        }
        setReassignSearch('');
    }, [selectedCenterId]);

    // ── Pending changes counter ───────────────────────────────────────────────
    useEffect(() => {
        const changes = clients.filter((c) => {
            const a = clientAssignments[c.id];
            if (!a) return false;
            return a.groupId !== (c.groupId || 'none');
        }).length;
        setPendingChanges(changes);
    }, [clientAssignments, clients]);

    // ─── Fetch helpers ────────────────────────────────────────────────────────

    const loadBranches = async () => {
        if (isAdminOrAM) {
            setIsLoadingBranches(true);
            try {
                let list: Center[] = [];
                if (storedUser?.role === 'ADMIN' || storedUser?.role === 'ADMIN_NON_HO_BRANCH_SWITCH') {
                    const result = await apiClient.get<Center[]>('/branches');
                    if (result.success && result.data) {
                        list = result.data.map((b) => ({ id: b.id, name: b.name, code: b.code }));
                    }
                } else if (storedUser?.id) {
                    // AREA_MANAGER: only branches assigned to them via AreaManagerBranch —
                    // previously this fetched every branch in the system, same as ADMIN,
                    // letting an AM filter/assign against branches outside their scope.
                    const result = await apiClient.get<{ branch: Center }[]>(`/area-manager-branches?userId=${storedUser.id}`);
                    if (result.success && result.data) {
                        list = result.data.map((a) => a.branch);
                    }
                }
                setBranches(list);
                const activeBranch = branchStorage.getActiveBranch();
                const preferredId = activeBranch?.id ?? storedUser?.branchId;
                const match = list.find((b) => b.id === preferredId) ?? list[0];
                if (match) {
                    setSelectedBranchId(match.id);
                } else {
                    // No branch resolved (e.g. an AM with zero assigned branches) — the
                    // branch-driven effect below will never fire, so clear these loading
                    // flags here instead of leaving them spinning forever.
                    setIsLoadingCenters(false);
                    setIsLoadingUnassigned(false);
                }
            } catch {
                toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' });
                setIsLoadingCenters(false);
                setIsLoadingUnassigned(false);
            } finally {
                setIsLoadingBranches(false);
            }
        } else {
            const activeBranch = branchStorage.getActiveBranch();
            const branchId = activeBranch?.id ?? storedUser?.branchId ?? '';
            setBranchName(activeBranch?.name ?? '');
            setSelectedBranchId(branchId);
            if (!branchId) {
                // No branch on this user's record — the branch-driven effect below
                // will never fire, so clear these instead of leaving them spinning.
                setIsLoadingCenters(false);
                setIsLoadingUnassigned(false);
            }
        }
    };

    const fetchCenters = async (branchId: string) => {
        if (!branchId) return;
        setIsLoadingCenters(true);
        try {
            const result = await apiClient.get<Center[]>(`/centers?branchId=${branchId}&includeInactive=false&status=APPROVED`);
            if (result.success && result.data) {
                setCenters(result.data);
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to load centers.', variant: 'destructive' });
                setCenters([]);
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to load centers. Please try again.', variant: 'destructive' });
            setCenters([]);
        } finally {
            setIsLoadingCenters(false);
        }
    };

    // Fetched WITHOUT availableOnly so a client's current group can still be
    // looked up (and shown as a badge) even if it has since filled up — the
    // dropdown itself filters full groups client-side (see availableGroups).
    const fetchGroups = async (centerId: string) => {
        setIsLoadingGroups(true);
        try {
            const result = await apiClient.get<Group[]>(`/groups?centerId=${centerId}&includeInactive=false`);
            setGroups(result.success && result.data ? result.data : []);
        } catch {
            setGroups([]);
        } finally {
            setIsLoadingGroups(false);
        }
    };

    /** Groups with spare capacity for a given center, cached per centerId — used by the "Assign Center" tab's per-row Group selector. */
    const fetchGroupsForCenter = async (centerId: string) => {
        if (groupsByCenterId[centerId] || loadingGroupsForCenterId[centerId]) return;
        setLoadingGroupsForCenterId((prev) => ({ ...prev, [centerId]: true }));
        try {
            const result = await apiClient.get<Group[]>(`/groups?centerId=${centerId}&includeInactive=false&availableOnly=true`);
            setGroupsByCenterId((prev) => ({ ...prev, [centerId]: result.success && result.data ? result.data : [] }));
        } catch {
            setGroupsByCenterId((prev) => ({ ...prev, [centerId]: [] }));
        } finally {
            setLoadingGroupsForCenterId((prev) => ({ ...prev, [centerId]: false }));
        }
    };

    const fetchClients = async (centerId: string) => {
        setIsLoadingClients(true);
        try {
            const result = await apiClient.get<{ clients: Client[]; pagination: unknown }>(
                `/clients?centerId=${centerId}&includeInactive=false&pageSize=1000`
            );
            if (result.success && result.data) {
                const list = result.data.clients || [];
                setClients(list);
                const init: Record<string, ClientAssignment> = {};
                list.forEach((c) => { init[c.id] = { clientId: c.id, groupId: c.groupId || 'none' }; });
                setClientAssignments(init);
                if (list.length === 0)
                    toast({ title: 'No Records', description: 'No members or clients found for the selected center.' });
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to load records.', variant: 'destructive' });
                setClients([]);
                setClientAssignments({});
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to load records. Please try again.', variant: 'destructive' });
            setClients([]);
            setClientAssignments({});
        } finally {
            setIsLoadingClients(false);
        }
    };

    const fetchUnassignedClients = async (branchId?: string) => {
        setIsLoadingUnassigned(true);
        try {
            const query = branchId
                ? `/clients?noCenter=true&includeInactive=false&pageSize=1000&branchId=${branchId}`
                : '/clients?noCenter=true&includeInactive=false&pageSize=1000';
            const result = await apiClient.get<{ clients: Client[]; pagination: unknown }>(query);
            if (result.success && result.data) {
                const list = result.data.clients || [];
                setUnassignedClients(list);

                // Prefill from the FDO's enrollment-time request so the BM can approve
                // it with one click, or still override either dropdown before saving.
                const init: Record<string, NewClientAssignment> = {};
                list.forEach((c) => {
                    init[c.id] = {
                        clientDbId: c.id,
                        centerId: c.requestedCenterId || '',
                        groupId: c.requestedGroupId || '',
                    };
                });
                setNewAssignments(init);

                const requestedCenterIds = Array.from(new Set(list.map((c) => c.requestedCenterId).filter(Boolean))) as string[];
                requestedCenterIds.forEach((centerId) => fetchGroupsForCenter(centerId));
            } else {
                setUnassignedClients([]);
            }
        } catch {
            setUnassignedClients([]);
        } finally {
            setIsLoadingUnassigned(false);
        }
    };

    // ─── Reassign-group tab handlers ─────────────────────────────────────────

    const handleGroupChange = (clientId: string, newGroupId: string) => {
        setClientAssignments((prev) => ({ ...prev, [clientId]: { clientId, groupId: newGroupId } }));
    };

    const handleSubmitClick = () => {
        if (pendingChanges === 0) {
            toast({ title: 'No Changes', description: 'No group assignments have been modified.' });
            return;
        }
        setConfirmDialogOpen(true);
    };

    const onSubmitReassign = async () => {
        setConfirmDialogOpen(false);
        setIsSubmitting(true);
        try {
            const assignments = Object.values(clientAssignments)
                .filter((a) => {
                    const c = clients.find((cl) => cl.id === a.clientId);
                    return c && a.groupId !== (c.groupId || 'none');
                })
                .map((a) => ({ clientId: a.clientId, groupId: a.groupId === 'none' ? '' : a.groupId }));

            if (assignments.length === 0) {
                toast({ title: 'No Changes', description: 'No group assignments have been modified.' });
                setIsSubmitting(false);
                return;
            }

            const result = await apiClient.post('/client-operations/group-assign', {
                centerId: form.getValues('centerName'),
                assignments,
            });

            if (result.success) {
                toast({ title: 'Success', description: result.message || `Updated ${assignments.length} client(s).` });
                await fetchClients(form.getValues('centerName'));
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to assign groups.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to assign groups. Please try again.', variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReset = () => {
        const reset: Record<string, ClientAssignment> = {};
        clients.forEach((c) => { reset[c.id] = { clientId: c.id, groupId: c.groupId || 'none' }; });
        setClientAssignments(reset);
        toast({ title: 'Reset', description: 'All changes have been discarded.' });
    };

    // ─── New-clients tab handlers ─────────────────────────────────────────────

    const handleNewCenterChange = (clientDbId: string, centerId: string) => {
        setNewAssignments((prev) => ({
            ...prev,
            [clientDbId]: { ...prev[clientDbId], centerId, groupId: '' },
        }));
        if (centerId) fetchGroupsForCenter(centerId);
    };

    const handleNewGroupChange = (clientDbId: string, groupId: string) => {
        setNewAssignments((prev) => ({
            ...prev,
            [clientDbId]: { ...prev[clientDbId], groupId },
        }));
    };

    const pendingNewAssignments = Object.values(newAssignments).filter((a) => a.centerId !== '' && a.groupId !== '');

    const handleSubmitNewClick = () => {
        if (pendingNewAssignments.length === 0) {
            toast({ title: 'No Assignments', description: 'Please select a center and group for at least one client.', variant: 'destructive' });
            return;
        }
        setConfirmNewDialogOpen(true);
    };

    const onSubmitNew = async () => {
        setConfirmNewDialogOpen(false);
        setIsSubmittingNew(true);
        try {
            const assignments = pendingNewAssignments.map((a) => ({
                clientDbId: a.clientDbId,
                centerId: a.centerId,
                groupId: a.groupId,
            }));

            const result = await apiClient.post('/client-operations/center-group-assign', { assignments });

            if (result.success) {
                toast({
                    title: 'Success',
                    description: result.message || `Assigned ${assignments.length} client(s).`,
                });
                await fetchUnassignedClients(selectedBranchId || undefined); // refresh list
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to assign.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to assign. Please try again.', variant: 'destructive' });
        } finally {
            setIsSubmittingNew(false);
        }
    };

    // ─── Individual assign handlers (one row at a time) ──────────────────────

    const handleIndividualAssignClick = (clientDbId: string) => {
        const a = newAssignments[clientDbId];
        if (!a?.centerId || !a?.groupId) {
            toast({ title: 'Incomplete', description: 'Please select a center and group first.', variant: 'destructive' });
            return;
        }
        setIndividualConfirmClientId(clientDbId);
    };

    const onSubmitIndividual = async () => {
        const clientDbId = individualConfirmClientId;
        const a = clientDbId ? newAssignments[clientDbId] : undefined;
        if (!clientDbId || !a?.centerId || !a?.groupId) return;
        setIndividualConfirmClientId(null);
        setIndividualSubmittingId(clientDbId);
        try {
            const result = await apiClient.post('/client-operations/center-group-assign', {
                assignments: [{ clientDbId, centerId: a.centerId, groupId: a.groupId }],
            });

            if (result.success) {
                toast({ title: 'Success', description: result.message || 'Member assigned successfully.' });
                await fetchUnassignedClients(selectedBranchId || undefined);
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to assign.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to assign. Please try again.', variant: 'destructive' });
        } finally {
            setIndividualSubmittingId(null);
        }
    };

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
                    Center & Group Assignment
                </h1>
                <p className="text-muted-foreground">
                    Assign a center and group to newly enrolled clients, or reassign groups within an existing center
                </p>
            </div>

            {/* Branch filter — visible only for Admin / Area Manager; scopes the Center pickers below */}
            {isAdminOrAM ? (
                <div className="max-w-xs space-y-2">
                    <Label className="text-sm font-medium">Branch</Label>
                    <Select
                        value={selectedBranchId}
                        onValueChange={setSelectedBranchId}
                        disabled={isLoadingBranches || branches.length === 0}
                    >
                        <SelectTrigger className="h-11 w-full">
                            <SelectValue placeholder="-- SELECT BRANCH --" />
                        </SelectTrigger>
                        <SelectContent>
                            {branches.map((b) => (
                                <SelectItem key={b.id} value={b.id}>
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium">{b.name}</span>
                                        <span className="text-muted-foreground">({b.code})</span>
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            ) : (
                <div className="max-w-xs space-y-2">
                    <Label className="text-sm font-medium">Branch</Label>
                    <div className="flex h-11 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                        {branchName || 'Current Branch'}
                    </div>
                </div>
            )}

            {!mounted ? (
                <div className="space-y-4">
                    <div className="grid w-full grid-cols-2 gap-1 rounded-md bg-muted p-1">
                        <div className="h-8 animate-pulse rounded-sm bg-background/60" />
                        <div className="h-8 animate-pulse rounded-sm bg-background/60" />
                    </div>
                    <div className="h-48 animate-pulse rounded-md border border-border/60 bg-muted/30" />
                </div>
            ) : (
            <Tabs defaultValue="new-clients" id="group-assign-tabs">
                <TabsList className="grid w-full grid-cols-2 mb-4">
                    <TabsTrigger value="new-clients" className="flex items-center gap-2">
                        <UserPlus className="h-4 w-4" />
                        Assign Center
                        {unassignedClients.length > 0 && (
                            <Badge variant="destructive" className="ml-1 text-xs">
                                {unassignedClients.length}
                            </Badge>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="reassign" className="flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        Reassign Group
                    </TabsTrigger>
                </TabsList>

                {/* ════════════════════════════════════════════════════════════
                    TAB 1: Assign Center + Group for new (unassigned) clients —
                    both are picked manually; no group is ever created here
                ════════════════════════════════════════════════════════════ */}
                <TabsContent value="new-clients" className="space-y-4">
                    <Tabs defaultValue="bulk" id="assign-center-mode-tabs">
                        <TabsList className="grid w-full max-w-md grid-cols-2 mb-4">
                            <TabsTrigger value="bulk" className="flex items-center gap-2">
                                <Users className="h-4 w-4" />
                                Bulk Assign
                            </TabsTrigger>
                            <TabsTrigger value="individual" className="flex items-center gap-2">
                                <Search className="h-4 w-4" />
                                Individual Assign
                            </TabsTrigger>
                        </TabsList>

                    <TabsContent value="bulk" className="space-y-4">
                    <Card className="border-2 border-primary/20 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                    <UserPlus className="h-5 w-5 text-primary dark:text-primary" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl">Newly Enrolled Members</CardTitle>
                                    <CardDescription>
                                        Members who have been enrolled but not yet assigned to a center — pick a center and group for each
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>

                        <CardContent className="pt-6">
                            {!isLoadingUnassigned && unassignedClients.length > 0 && (
                                <div className="relative mb-4 max-w-sm">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        value={unassignedSearch}
                                        onChange={(e) => setUnassignedSearch(e.target.value)}
                                        placeholder="Search by Member ID (e.g. 34-1-1-1), name, Aadhaar or phone…"
                                        className="pl-9 h-10"
                                    />
                                </div>
                            )}
                            {isLoadingUnassigned ? (
                                <PageLoader label="Loading members…" fullScreen={false} />
                            ) : unassignedClients.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12">
                                    <div className="rounded-full bg-muted p-4 mb-4">
                                        <CheckCircle2 className="h-8 w-8 text-green-500" />
                                    </div>
                                    <h3 className="text-lg font-semibold mb-2">All members are assigned!</h3>
                                    <p className="text-sm text-muted-foreground text-center max-w-md">
                                        No newly enrolled members are waiting for center &amp; group assignment.
                                    </p>
                                </div>
                            ) : filteredUnassignedClients.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12">
                                    <div className="rounded-full bg-muted p-4 mb-4">
                                        <Search className="h-8 w-8 text-muted-foreground" />
                                    </div>
                                    <h3 className="text-lg font-semibold mb-2">No matching members</h3>
                                    <p className="text-sm text-muted-foreground text-center max-w-md">
                                        No members match &quot;{unassignedSearch}&quot;.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    <UnassignedClientsTable
                                        clients={filteredUnassignedClients}
                                        assignments={newAssignments}
                                        centers={centers}
                                        isLoadingCenters={isLoadingCenters}
                                        groupsByCenterId={groupsByCenterId}
                                        loadingGroupsForCenterId={loadingGroupsForCenterId}
                                        onCenterChange={handleNewCenterChange}
                                        onGroupChange={handleNewGroupChange}
                                    />

                                    {/* Action buttons */}
                                    <div className="flex flex-wrap gap-3 pt-4">
                                        <Button
                                            type="button"
                                            onClick={handleSubmitNewClick}
                                            disabled={!canEditClient || isSubmittingNew || pendingNewAssignments.length === 0}
                                            className="flex-1 min-w-[160px] bg-primary hover:bg-primary text-white"
                                            size="lg"
                                        >
                                            {isSubmittingNew ? (
                                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
                                            ) : (
                                                <><CheckCircle2 className="mr-2 h-4 w-4" />Save Assignments ({pendingNewAssignments.length})</>
                                            )}
                                        </Button>

                                        <Button
                                            type="button"
                                            onClick={() => fetchUnassignedClients(selectedBranchId || undefined)}
                                            variant="outline"
                                            size="lg"
                                            className="flex-1 min-w-[120px]"
                                            disabled={isLoadingUnassigned}
                                        >
                                            {isLoadingUnassigned ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                                            Refresh
                                        </Button>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>
                    </TabsContent>

                    {/* ════════════════════════════════════════════════════════
                        Individual Assign — same table, assign one row at a time
                    ════════════════════════════════════════════════════════ */}
                    <TabsContent value="individual" className="space-y-4">
                        <Card className="border-2 border-primary/20 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                            <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                            <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                        <UserPlus className="h-5 w-5 text-primary dark:text-primary" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Newly Enrolled Members</CardTitle>
                                        <CardDescription>
                                            Pick a center and group for a member, then assign them individually
                                        </CardDescription>
                                    </div>
                                </div>
                            </CardHeader>

                            <CardContent className="pt-6">
                                {isLoadingUnassigned ? (
                                    <PageLoader label="Loading members…" fullScreen={false} />
                                ) : unassignedClients.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-12">
                                        <div className="rounded-full bg-muted p-4 mb-4">
                                            <CheckCircle2 className="h-8 w-8 text-green-500" />
                                        </div>
                                        <h3 className="text-lg font-semibold mb-2">All members are assigned!</h3>
                                        <p className="text-sm text-muted-foreground text-center max-w-md">
                                            No newly enrolled members are waiting for center &amp; group assignment.
                                        </p>
                                    </div>
                                ) : (
                                    <UnassignedClientsTable
                                        clients={unassignedClients}
                                        assignments={newAssignments}
                                        centers={centers}
                                        isLoadingCenters={isLoadingCenters}
                                        groupsByCenterId={groupsByCenterId}
                                        loadingGroupsForCenterId={loadingGroupsForCenterId}
                                        onCenterChange={handleNewCenterChange}
                                        onGroupChange={handleNewGroupChange}
                                        actionColumn={(client) => {
                                            const a = newAssignments[client.id];
                                            return (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    onClick={() => handleIndividualAssignClick(client.id)}
                                                    disabled={!canEditClient || individualSubmittingId === client.id || !a?.centerId || !a?.groupId}
                                                    className="bg-primary hover:bg-primary text-white"
                                                >
                                                    {individualSubmittingId === client.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        'Assign'
                                                    )}
                                                </Button>
                                            );
                                        }}
                                    />
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                    </Tabs>
                </TabsContent>

                {/* ════════════════════════════════════════════════════════════
                    TAB 2: Reassign group for clients that already have a center
                ════════════════════════════════════════════════════════════ */}
                <TabsContent value="reassign" className="space-y-4">
                    <Card className="border-2 border-primary/20 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                        <UsersRound className="h-5 w-5 text-primary dark:text-primary" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Center Selection</CardTitle>
                                        <CardDescription>Select a center to manage group assignments</CardDescription>
                                    </div>
                                </div>
                                {pendingChanges > 0 && (
                                    <Badge variant="destructive" className="flex items-center gap-1">
                                        <AlertCircle className="h-3 w-3" />
                                        {pendingChanges} Pending Change{pendingChanges > 1 ? 's' : ''}
                                    </Badge>
                                )}
                            </div>
                        </CardHeader>

                        <CardContent className="pt-6">
                            <Form {...form}>
                                <form className="space-y-6">
                                    {isLoadingCenters ? (
                                        <PageLoader label="Loading centers…" fullScreen={false} />
                                    ) : (
                                        <>
                                            <FormField
                                                control={form.control}
                                                name="centerName"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">Center Name</FormLabel>
                                                        <Select onValueChange={field.onChange} value={field.value} disabled={centers.length === 0 || !selectedBranchId}>
                                                            <FormControl>
                                                                <SelectTrigger className="h-11 w-full">
                                                                    <SelectValue placeholder="-- SELECT CENTER --" />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                                {centers.length === 0 ? (
                                                                    <div className="px-2 py-1.5 text-sm text-muted-foreground">No centers available</div>
                                                                ) : (
                                                                    centers.map((c) => (
                                                                        <SelectItem key={c.id} value={c.id}>
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="font-medium">{c.name}</span>
                                                                                <span className="text-muted-foreground">({c.code})</span>
                                                                            </div>
                                                                        </SelectItem>
                                                                    ))
                                                                )}
                                                            </SelectContent>
                                                        </Select>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            {selectedCenterId && clients.length > 0 && (
                                                <div className="flex flex-wrap gap-3 pt-4">
                                                    <Button
                                                        type="button"
                                                        onClick={handleSubmitClick}
                                                        disabled={!canEditClient || isSubmitting || pendingChanges === 0}
                                                        className="flex-1 min-w-[120px] bg-primary hover:bg-primary text-white"
                                                        size="lg"
                                                    >
                                                        {isSubmitting ? (
                                                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
                                                        ) : (
                                                            <><CheckCircle2 className="mr-2 h-4 w-4" />Save Changes {pendingChanges > 0 && `(${pendingChanges})`}</>
                                                        )}
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        onClick={handleReset}
                                                        disabled={isSubmitting || pendingChanges === 0}
                                                        variant="outline"
                                                        className="flex-1 min-w-[120px]"
                                                        size="lg"
                                                    >
                                                        <RotateCcw className="mr-2 h-4 w-4" />
                                                        Discard Changes
                                                    </Button>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </form>
                            </Form>
                        </CardContent>
                    </Card>

                    {/* Clients table */}
                    {selectedCenterId && !isLoadingClients && clients.length > 0 && (
                        <Card className="border-2 border-primary/20 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                            <div className="h-1.5 bg-gradient-to-r from-purple-600 via-pink-600 to-fuchsia-600" />
                            <CardHeader className="bg-gradient-to-r from-slate-50 via-purple-50/60 to-pink-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                                        <Users className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Member / Client Group Assignments</CardTitle>
                                        <CardDescription>Select a group for each member/client</CardDescription>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-6">
                                <div className="relative mb-4 max-w-sm">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        value={reassignSearch}
                                        onChange={(e) => setReassignSearch(e.target.value)}
                                        placeholder="Search by ID (e.g. 34-1-1-1), name, Aadhaar or phone…"
                                        className="pl-9 h-10"
                                    />
                                </div>
                                {filteredClients.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-12">
                                        <div className="rounded-full bg-muted p-4 mb-4">
                                            <Search className="h-8 w-8 text-muted-foreground" />
                                        </div>
                                        <h3 className="text-lg font-semibold mb-2">No matching records</h3>
                                        <p className="text-sm text-muted-foreground text-center max-w-md">
                                            No records match &quot;{reassignSearch}&quot;.
                                        </p>
                                    </div>
                                ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="bg-brand-green-darker text-white hover:bg-brand-green-darker">
                                                <TableHead className="text-white font-semibold">ID</TableHead>
                                                <TableHead className="text-white font-semibold">Name</TableHead>
                                                <TableHead className="text-white font-semibold">Spouse Name</TableHead>
                                                <TableHead className="text-white font-semibold">Mobile</TableHead>
                                                <TableHead className="text-white font-semibold">Current Group</TableHead>
                                                <TableHead className="text-white font-semibold">Assign to Group</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {filteredClients.map((client, idx) => {
                                                const assignment = clientAssignments[client.id] || { clientId: client.id, groupId: 'none' };
                                                const fullName = `${client.firstName} ${client.lastName}`.trim();
                                                const currentGroupId = client.groupId || 'none';
                                                const newGroupId = assignment.groupId;
                                                const currentGroup = groups.find((g) => g.id === client.groupId);
                                                const availableGroups = groups.filter(
                                                    (g) => g.id !== currentGroupId && g.memberCount < g.maxMembersPerGroup
                                                );
                                                const hasChanged = newGroupId !== currentGroupId;

                                                return (
                                                    <TableRow
                                                        key={client.id}
                                                        className={cn(
                                                            'transition-colors',
                                                            hasChanged && 'bg-amber-50 dark:bg-amber-950/20 border-l-4 border-l-amber-500',
                                                            !hasChanged && idx % 2 === 0 ? 'bg-green-50 dark:bg-brand-green-darker/50' : 'bg-white dark:bg-sidebar-accent/50'
                                                        )}
                                                    >
                                                        <TableCell className="font-medium text-foreground dark:text-slate-100">{client.clientId}</TableCell>
                                                        <TableCell className="text-sidebar-accent dark:text-slate-300">
                                                            <div className="flex flex-wrap items-center gap-1.5">
                                                                <span>{fullName || '—'}</span>
                                                                <span className="inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary dark:bg-primary/20 dark:text-emerald-400">
                                                                    {getPersonLabel(!!client.hasLoan).singular}
                                                                </span>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-sidebar-accent dark:text-slate-300">{client.spouseName || '—'}</TableCell>
                                                        <TableCell className="text-sidebar-accent dark:text-slate-300">{client.phone || '—'}</TableCell>
                                                        <TableCell>
                                                            {currentGroup ? (
                                                                <Badge variant="secondary" className="font-medium">{currentGroup.name}</Badge>
                                                            ) : (
                                                                <span className="text-sm text-muted-foreground italic">Not assigned</span>
                                                            )}
                                                        </TableCell>
                                                        <TableCell>
                                                            <Select
                                                                value={assignment.groupId}
                                                                onValueChange={(v) => handleGroupChange(client.id, v)}
                                                                disabled={isLoadingGroups}
                                                            >
                                                                <SelectTrigger className={cn('h-9 w-full', hasChanged && 'border-amber-500 ring-2 ring-amber-500/20')}>
                                                                    <SelectValue placeholder={isLoadingGroups ? 'Loading…' : 'Select group'} />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {currentGroupId !== 'none' && (
                                                                        <SelectItem value="none">
                                                                            <span className="text-muted-foreground italic">Remove from Group</span>
                                                                        </SelectItem>
                                                                    )}
                                                                    {availableGroups.length === 0 && !isLoadingGroups ? (
                                                                        <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                                            {currentGroupId !== 'none' ? 'No other groups available.' : 'No groups available.'}
                                                                        </div>
                                                                    ) : (
                                                                        availableGroups.map((g) => (
                                                                            <SelectItem key={g.id} value={g.id}>
                                                                                {g.name} ({g.memberCount}/{g.maxMembersPerGroup})
                                                                            </SelectItem>
                                                                        ))
                                                                    )}
                                                                </SelectContent>
                                                            </Select>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Loading / empty states */}
                    {selectedCenterId && isLoadingClients && (
                        <PageLoader label="Loading clients…" fullScreen={false} />
                    )}
                    {selectedCenterId && !isLoadingClients && clients.length === 0 && (
                        <Card>
                            <CardContent className="flex flex-col items-center justify-center py-12">
                                <div className="rounded-full bg-muted p-4 mb-4">
                                    <UsersRound className="h-8 w-8 text-muted-foreground" />
                                </div>
                                <h3 className="text-lg font-semibold mb-2">No Clients Found</h3>
                                <p className="text-sm text-muted-foreground text-center max-w-md">
                                    No active clients for the selected center.
                                </p>
                            </CardContent>
                        </Card>
                    )}
                    {!isLoadingCenters && centers.length === 0 && (
                        <Card>
                            <CardContent className="flex flex-col items-center justify-center py-12">
                                <div className="rounded-full bg-muted p-4 mb-4">
                                    <Building2 className="h-8 w-8 text-muted-foreground" />
                                </div>
                                <h3 className="text-lg font-semibold mb-2">No Centers Found</h3>
                                <p className="text-sm text-muted-foreground text-center max-w-md">
                                    No active centers available. Please create a center first.
                                </p>
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>
            </Tabs>
            )}

            {/* ── Confirmation dialog: reassign groups ──────────────────────── */}
            <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertCircle className="h-5 w-5 text-amber-600" />
                            Confirm Group Reassignment
                        </DialogTitle>
                        <DialogDescription>
                            You are about to update group assignments for {pendingChanges} client{pendingChanges > 1 ? 's' : ''}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <div className="rounded-lg bg-muted p-4 space-y-2">
                            <p className="text-sm font-medium">Changes Summary:</p>
                            <ul className="text-sm text-muted-foreground space-y-1">
                                <li>• {pendingChanges} client{pendingChanges > 1 ? 's' : ''} will be reassigned</li>
                                <li>• Previous group assignments will be replaced</li>
                            </ul>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmDialogOpen(false)} disabled={isSubmitting}>Cancel</Button>
                        <Button onClick={onSubmitReassign} disabled={isSubmitting} className="bg-primary hover:bg-primary">
                            {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : <><CheckCircle2 className="mr-2 h-4 w-4" />Confirm &amp; Save</>}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Confirmation dialog: new center+group assignment ──────────── */}
            <Dialog open={confirmNewDialogOpen} onOpenChange={setConfirmNewDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertCircle className="h-5 w-5 text-amber-600" />
                            Confirm Center & Group Assignment
                        </DialogTitle>
                        <DialogDescription>
                            You are about to assign a center and group to{' '}
                            {pendingNewAssignments.length} member{pendingNewAssignments.length > 1 ? 's' : ''}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <div className="rounded-lg bg-muted p-4 space-y-2">
                            <p className="text-sm font-medium">What will happen:</p>
                            <ul className="text-sm text-muted-foreground space-y-1">
                                <li>• Each member will be linked to their selected center and group</li>
                                <li>• A new center-based Member ID will be generated</li>
                                <li>• If someone else fills the selected group first, that member&apos;s assignment will be rejected — please pick another group and retry</li>
                            </ul>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmNewDialogOpen(false)} disabled={isSubmittingNew}>Cancel</Button>
                        <Button onClick={onSubmitNew} disabled={isSubmittingNew} className="bg-primary hover:bg-primary">
                            {isSubmittingNew ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : <><CheckCircle2 className="mr-2 h-4 w-4" />Confirm &amp; Save</>}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Confirmation dialog: individual center+group assignment ──── */}
            <Dialog open={individualConfirmClientId !== null} onOpenChange={(open) => !open && setIndividualConfirmClientId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertCircle className="h-5 w-5 text-amber-600" />
                            Confirm Assignment
                        </DialogTitle>
                        <DialogDescription>
                            You are about to assign a center and group to{' '}
                            {individualConfirmClient
                                ? `${individualConfirmClient.firstName} ${individualConfirmClient.lastName}`.trim() || individualConfirmClient.clientId
                                : 'this member'}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <div className="rounded-lg bg-muted p-4 space-y-2">
                            <p className="text-sm font-medium">What will happen:</p>
                            <ul className="text-sm text-muted-foreground space-y-1">
                                <li>• The member will be linked to the selected center and group</li>
                                <li>• A new center-based Member ID will be generated</li>
                                <li>• If someone else fills the selected group first, this assignment will be rejected — please pick another group and retry</li>
                            </ul>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIndividualConfirmClientId(null)} disabled={individualSubmittingId !== null}>Cancel</Button>
                        <Button onClick={onSubmitIndividual} disabled={individualSubmittingId !== null} className="bg-primary hover:bg-primary">
                            {individualSubmittingId !== null ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : <><CheckCircle2 className="mr-2 h-4 w-4" />Confirm &amp; Save</>}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
