'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Users2, UserPlus, PenLine, ChevronLeft, ChevronRight, Pencil, UserX, UserCheck, IdCard, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import { usePermission } from '@/app/hooks/usePermission';
import { SignatureUploadDialog } from '@/components/hr/SignatureUploadDialog';
import { useAuthStore } from '@/app/store/authStore';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useEmployeeIdCard } from '@/components/hr/useEmployeeIdCard';

type EmployeeRow = {
    id: string;
    employeeId: string | null;
    firstName: string;
    lastName: string;
    role: string;
    isActive: boolean;
    mobileNumber: string | null;
    branch: { id: string; name: string; code: string } | null;
    department: { id: string; name: string } | null;
    designation: { id: string; name: string } | null;
    /** From ?includeIdCard=1, only when `branch` is null (Area Manager / org-wide staff) — see employee-display-branch.ts. */
    displayBranch?: { name: string; code: string; source: 'ASSIGNED' | 'AREA_MANAGER' | 'HEAD_OFFICE' } | null;
    /** From ?includeIdCard=1 — see summarizeIdCardStatus in app/lib/hr/id-card-eligibility.ts. */
    idCard?: { status: IdCardStatus; issues: string[]; issuedAt: string | null; reprintRequired: boolean } | null;
};

type IdCardStatus = 'ELIGIBLE' | 'INCOMPLETE' | 'NOT_EMPLOYED';
/** List filter buckets — REPRINT is an eligible card whose printed details changed since it was issued. */
type IdCardFilter = IdCardStatus | 'REPRINT';

const ID_CARD_FILTER_LABELS: Record<IdCardFilter, string> = {
    ELIGIBLE: 'ID: Ready',
    REPRINT: 'ID: Reprint required',
    INCOMPLETE: 'ID: Incomplete',
    NOT_EMPLOYED: 'ID: Not employed',
};

function idCardFilterOf(idCard: EmployeeRow['idCard']): IdCardFilter | null {
    if (!idCard) return null;
    return idCard.reprintRequired ? 'REPRINT' : idCard.status;
}

type LookupOption = { id: string; name: string };

const PAGE_SIZE = 15;

export function EmployeeList() {
    const router = useRouter();
    const { toast } = useToast();
    const [employees, setEmployees] = useState<EmployeeRow[]>([]);
    const [departments, setDepartments] = useState<LookupOption[]>([]);
    const [designations, setDesignations] = useState<LookupOption[]>([]);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
    const [idCardFilter, setIdCardFilter] = useState<'all' | IdCardFilter>('all');
    const [departmentFilter, setDepartmentFilter] = useState<string>('all');
    const [designationFilter, setDesignationFilter] = useState<string>('all');
    const [signatureDialogOpen, setSignatureDialogOpen] = useState(false);
    const { hasRole } = usePermission();
    const isAdmin = hasRole('admin');
    const currentUserId = useAuthStore((s) => s.user?.id);
    const [confirmEmployee, setConfirmEmployee] = useState<EmployeeRow | null>(null);
    const [isTogglingActive, setIsTogglingActive] = useState(false);
    // Live card from the saved User row (or what's missing, if not eligible).
    // After a print / PDF download, refetch so that row's "Reprint" badge clears.
    const { openForEmployee: handleViewIdCard, loadingFor: loadingIdCardFor, dialogs: idCardDialogs } = useEmployeeIdCard({
        onIssued: () => void fetchEmployees(),
    });

    const handleToggleActiveConfirm = async () => {
        if (!confirmEmployee) return;
        setIsTogglingActive(true);
        try {
            const res = await apiClient.patch<EmployeeRow>(`/hr/employees/${confirmEmployee.id}`, {
                isActive: !confirmEmployee.isActive,
            });
            if (res.success) {
                toast({
                    title: confirmEmployee.isActive ? 'Deactivated' : 'Reactivated',
                    description: `${confirmEmployee.firstName} ${confirmEmployee.lastName} is now ${confirmEmployee.isActive ? 'inactive' : 'active'}.`,
                });
                setConfirmEmployee(null);
                await fetchEmployees();
            } else {
                throw new Error(res.error || 'Failed to update status');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to update status.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setIsTogglingActive(false);
        }
    };

    const fetchEmployees = useCallback(async () => {
        try {
            const params = new URLSearchParams({ includeIdCard: '1' });
            if (statusFilter !== 'all') params.set('status', statusFilter);
            if (departmentFilter !== 'all') params.set('departmentId', departmentFilter);
            if (designationFilter !== 'all') params.set('designationId', designationFilter);
            const qs = params.toString();
            const res = await apiClient.get<EmployeeRow[]>(`/hr/employees${qs ? `?${qs}` : ''}`);
            if (res.success && res.data) {
                setEmployees(res.data);
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch employees.', variant: 'destructive' });
        } finally {
            setIsInitialLoading(false);
        }
    }, [toast, statusFilter, departmentFilter, designationFilter]);

    useEffect(() => {
        fetchEmployees();
    }, [fetchEmployees]);

    useEffect(() => {
        const fetchFilterLookups = async () => {
            const [deptRes, desigRes] = await Promise.all([
                apiClient.get<LookupOption[]>('/hr/departments'),
                apiClient.get<LookupOption[]>('/hr/designations'),
            ]);
            if (deptRes.success && deptRes.data) setDepartments(deptRes.data);
            if (desigRes.success && desigRes.data) setDesignations(desigRes.data);
        };
        fetchFilterLookups();
    }, []);

    const idCardCounts = employees.reduce<Record<IdCardFilter, number>>(
        (acc, e) => {
            const bucket = idCardFilterOf(e.idCard);
            if (bucket) acc[bucket]++;
            return acc;
        },
        { ELIGIBLE: 0, REPRINT: 0, INCOMPLETE: 0, NOT_EMPLOYED: 0 }
    );
    const idCardFilteredRows = useMemo(
        () => (idCardFilter === 'all' ? employees : employees.filter((e) => idCardFilterOf(e.idCard) === idCardFilter)),
        [employees, idCardFilter]
    );
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(idCardFilteredRows);

    const [currentPage, setCurrentPage] = useState(1);
    const totalPages = Math.max(1, Math.ceil(searchedRows.length / PAGE_SIZE));
    const safePage = Math.min(currentPage, totalPages);
    const paginatedRows = searchedRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    // Any change to the underlying rows (filters, search) can shrink the
    // result set below the current page — snap back to page 1 rather than
    // showing an empty page.
    useEffect(() => {
        setCurrentPage(1);
    }, [statusFilter, departmentFilter, designationFilter, idCardFilter, tableSearchQuery]);

    if (isInitialLoading) {
        return <PageLoader label="Loading Employees..." fullScreen={false} />;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-7xl space-y-6">
                <div className="mb-8 flex items-center justify-between mt-4 flex-wrap gap-3">
                    <div className="flex items-center gap-4">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <Users2 className="h-7 w-7 text-white" />
                            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">Employee Master</h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                Employees within your branch scope.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        {isAdmin && (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setSignatureDialogOpen(true)}
                                className="gap-2"
                            >
                                <PenLine className="h-4 w-4" />
                                Update Signature
                            </Button>
                        )}
                        <Button
                            type="button"
                            onClick={() => router.push('/dashboard/hr/onboarding')}
                            className="gap-2 bg-primary text-white"
                        >
                            <UserPlus className="h-4 w-4" />
                            New Employee
                        </Button>
                    </div>
                </div>

                {isAdmin && (
                    <SignatureUploadDialog open={signatureDialogOpen} onOpenChange={setSignatureDialogOpen} />
                )}

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4 space-y-3">
                        <CardTitle className="text-lg font-semibold text-white flex items-center justify-between">
                            Employees
                            <Badge variant="outline" className="text-white border-white/40">{searchedRows.length}</Badge>
                        </CardTitle>
                        <div className="flex flex-wrap items-center gap-3">
                            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                                <SelectTrigger className="w-36 bg-white dark:bg-sidebar-accent">
                                    <SelectValue placeholder="Status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Status</SelectItem>
                                    <SelectItem value="active">Active</SelectItem>
                                    <SelectItem value="inactive">Inactive</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                                <SelectTrigger className="w-44 bg-white dark:bg-sidebar-accent">
                                    <SelectValue placeholder="Department" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Departments</SelectItem>
                                    {departments.map((d) => (
                                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={designationFilter} onValueChange={setDesignationFilter}>
                                <SelectTrigger className="w-44 bg-white dark:bg-sidebar-accent">
                                    <SelectValue placeholder="Designation" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Designations</SelectItem>
                                    {designations.map((d) => (
                                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={idCardFilter} onValueChange={(v) => setIdCardFilter(v as typeof idCardFilter)}>
                                <SelectTrigger className="w-48 bg-white dark:bg-sidebar-accent">
                                    <SelectValue placeholder="ID Card" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All ID Card Status</SelectItem>
                                    {(Object.keys(ID_CARD_FILTER_LABELS) as IdCardFilter[]).map((status) => (
                                        <SelectItem key={status} value={status}>
                                            {ID_CARD_FILTER_LABELS[status]} ({idCardCounts[status]})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <TableSearchInput
                                value={tableSearchQuery}
                                onChange={setTableSearchQuery}
                                placeholder="Search by name, employee ID, or mobile..."
                                className="ml-auto bg-white dark:bg-sidebar-accent rounded-md"
                            />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                        <TableHead className="font-bold text-foreground dark:text-slate-100 uppercase text-xs">Employee</TableHead>
                                        <TableHead className="font-bold text-foreground dark:text-slate-100 uppercase text-xs">Branch</TableHead>
                                        <TableHead className="font-bold text-foreground dark:text-slate-100 uppercase text-xs">Department</TableHead>
                                        <TableHead className="font-bold text-foreground dark:text-slate-100 uppercase text-xs">Designation</TableHead>
                                        <TableHead className="w-28 text-center font-bold text-foreground dark:text-slate-100 uppercase text-xs">Status</TableHead>
                                        <TableHead className={`${isAdmin ? 'w-64' : 'w-28'} text-center font-bold text-foreground dark:text-slate-100 uppercase text-xs`}>Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedRows.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="px-4 py-12 text-center text-slate-500">
                                                <div className="flex flex-col items-center gap-2">
                                                    <Users2 className="h-8 w-8 opacity-20" />
                                                    <p>{tableSearchQuery ? 'No employees match your search.' : 'No employees found.'}</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        paginatedRows.map((employee) => (
                                            <TableRow key={employee.id} className="group transition-colors dark:hover:bg-sidebar-accent/50">
                                                <TableCell className="px-4 py-3">
                                                    <div className="text-sm font-medium text-sidebar-accent dark:text-slate-200">
                                                        {employee.firstName} {employee.lastName}
                                                    </div>
                                                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                                                        {employee.employeeId || '—'} · {employee.mobileNumber || '—'}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-sm text-sidebar-accent dark:text-slate-300">
                                                    {employee.branch?.name ??
                                                        (employee.displayBranch ? (
                                                            <span>
                                                                {employee.displayBranch.name}
                                                                <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-sidebar-accent dark:text-slate-400">
                                                                    {employee.displayBranch.source === 'AREA_MANAGER' ? 'AM primary' : 'Head Office'}
                                                                </span>
                                                            </span>
                                                        ) : (
                                                            '—'
                                                        ))}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-sm text-sidebar-accent dark:text-slate-300">
                                                    {employee.department?.name || '—'}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-sm text-sidebar-accent dark:text-slate-300">
                                                    {employee.designation?.name || '—'}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-center">
                                                    <Badge variant={employee.isActive ? 'default' : 'outline'}>
                                                        {employee.isActive ? 'Active' : 'Inactive'}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-center">
                                                    <div className="flex items-center justify-center gap-1.5">
                                                            <IdCardButton
                                                                idCard={employee.idCard}
                                                                loading={loadingIdCardFor === employee.id}
                                                                onClick={() => handleViewIdCard(employee.id)}
                                                            />
                                                            {isAdmin && (
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => router.push(`/dashboard/hr/employees/${employee.id}`)}
                                                                    className="h-8 px-2 text-primary hover:bg-green-50 dark:text-primary dark:hover:bg-brand-green-darker/30 gap-1 text-xs font-medium"
                                                                    title="Edit"
                                                                >
                                                                    <Pencil className="h-3.5 w-3.5" />
                                                                    <span>Edit</span>
                                                                </Button>
                                                            )}
                                                            {isAdmin && !(currentUserId === employee.id && employee.isActive) && (
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="outline"
                                                                    onClick={() => setConfirmEmployee(employee)}
                                                                    className={employee.isActive
                                                                        ? "h-8 gap-1 border-red-500/30 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-950/20 text-xs font-medium"
                                                                        : "h-8 gap-1 border-emerald-500/30 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-400 dark:hover:bg-emerald-950/20 text-xs font-medium"}
                                                                    title={employee.isActive ? 'Deactivate' : 'Reactivate'}
                                                                >
                                                                    {employee.isActive ? (
                                                                        <>
                                                                            <UserX className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                                                                            <span>Deactivate</span>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <UserCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                                                            <span>Reactivate</span>
                                                                        </>
                                                                    )}
                                                                </Button>
                                                            )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                        {searchedRows.length > 0 && (
                            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-sidebar-accent px-4 py-3">
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, searchedRows.length)} of {searchedRows.length}
                                </p>
                                <div className="flex items-center gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                        disabled={safePage <= 1}
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                        Previous
                                    </Button>
                                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 px-1">
                                        Page {safePage} of {totalPages}
                                    </span>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                        disabled={safePage >= totalPages}
                                    >
                                        Next
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <ConfirmationDialog
                    open={!!confirmEmployee}
                    onOpenChange={(open) => !open && setConfirmEmployee(null)}
                    onConfirm={handleToggleActiveConfirm}
                    title={
                        confirmEmployee
                            ? confirmEmployee.isActive
                                ? `Deactivate ${confirmEmployee.firstName} ${confirmEmployee.lastName}?`
                                : `Reactivate ${confirmEmployee.firstName} ${confirmEmployee.lastName}?`
                            : ''
                    }
                    description={
                        confirmEmployee
                            ? confirmEmployee.isActive
                                ? 'This will make the record inactive. Existing data and references will be preserved.'
                                : 'This will make the record active again. Existing data and references will be preserved.'
                            : ''
                    }
                    confirmText={confirmEmployee?.isActive ? 'Deactivate' : 'Reactivate'}
                    cancelText="Cancel"
                    type={confirmEmployee?.isActive ? 'delete' : 'success'}
                    isLoading={isTogglingActive}
                />

                {idCardDialogs}
            </div>
        </div>
    );
}

/**
 * Row action reflecting the employee's ID card status:
 *  - Ready        → green "View ID", opens the card
 *  - Incomplete   → yellow "Incomplete", opens the what's-missing dialog
 *  - Not employed → disabled (inactive/exited — no card to issue)
 * Status comes from the list API; the card API re-checks on click regardless.
 */
function IdCardButton({
    idCard,
    loading,
    onClick,
}: {
    idCard: EmployeeRow['idCard'];
    loading: boolean;
    onClick: () => void;
}) {
    const status = idCard?.status;
    const reasons = idCard?.issues.join('\n') ?? '';
    const icon = loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <IdCard className="h-3.5 w-3.5" />;

    if (status === 'NOT_EMPLOYED') {
        return (
            <span title={reasons} className="inline-flex">
                <Button type="button" size="sm" variant="ghost" disabled className="h-8 px-2 gap-1 text-xs font-medium text-slate-400">
                    <IdCard className="h-3.5 w-3.5" />
                    <span>No ID card</span>
                </Button>
            </span>
        );
    }

    const incomplete = status === 'INCOMPLETE';
    const reprint = !incomplete && !!idCard?.reprintRequired;
    const issuedLabel = idCard?.issuedAt ? `Last printed ${new Date(idCard.issuedAt).toLocaleDateString('en-IN')}` : 'Not printed yet';
    // blue isn't remapped by the theme (globals.css), so "Reprint" stays distinct from the green/yellow states.
    const tone = incomplete
        ? 'text-yellow-700 hover:bg-yellow-50 dark:text-yellow-300 dark:hover:bg-yellow-950/20'
        : reprint
          ? 'text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/20'
          : 'text-green-700 hover:bg-green-50 dark:text-green-300 dark:hover:bg-green-950/20';
    return (
        <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClick}
            disabled={loading}
            title={
                incomplete
                    ? `ID card cannot be issued yet:\n${reasons}`
                    : reprint
                      ? `Details printed on the card have changed since it was printed — print a new card.\n${issuedLabel}`
                      : `View ID Card\n${issuedLabel}`
            }
            className={`h-8 px-2 gap-1 text-xs font-medium ${tone}`}
        >
            {icon}
            <span>{incomplete ? 'Incomplete' : reprint ? 'Reprint' : 'View ID'}</span>
        </Button>
    );
}
