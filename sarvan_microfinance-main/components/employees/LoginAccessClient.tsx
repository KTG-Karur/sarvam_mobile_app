'use client';

import { useCallback, useEffect, useState } from 'react';
import { MonitorSmartphone, Download, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageLoader } from '@/components/ui/page-loader';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';

type AccountStatus = 'ACTIVE' | 'INACTIVE' | 'EXITED';
type StatusFilter = 'ALL' | 'ACTIVE' | 'BLOCKED';

interface LoginAccessRow {
  id: string;
  employeeId: string | null;
  name: string;
  roleName: string;
  branch: { id: string; name: string; code: string } | null;
  accountStatus: AccountStatus;
  webLoginEnabled: boolean;
  mobileLoginEnabled: boolean;
}

interface ListResponse {
  employees: LoginAccessRow[];
  totalCount: number;
  totalPages: number;
  page: number;
}

const STATUS_LABEL: Record<AccountStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive / Deleted',
  EXITED: 'Exited',
};

export function LoginAccessClient() {
  const { toast } = useToast();
  const [rows, setRows] = useState<LoginAccessRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [branchId, setBranchId] = useState('all');
  const [branches, setBranches] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [role, setRole] = useState('all');
  // Fallback list mirrors User Management; replaced by the DB-managed roles when /admin/roles is readable.
  const [roleOptions, setRoleOptions] = useState<Array<{ legacyRole: string; name: string }>>([
    { legacyRole: 'ADMIN', name: 'Admin' },
    { legacyRole: 'BRANCH_MANAGER', name: 'Branch Manager' },
    { legacyRole: 'AREA_MANAGER', name: 'Area Manager' },
    { legacyRole: 'FDO', name: 'Field Development Officer' },
  ]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // The branches API is already scoped to what the caller may see, so Sub Admins get a filter too.
  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const result = await apiClient.get<Array<{ id: string; name: string; code: string }>>('/branches');
        if (result.success && result.data) setBranches(result.data);
      } catch {
        // list stays empty; "All Branches" still works
      }
    };
    fetchBranches();
  }, []);

  useEffect(() => {
    const fetchRoles = async () => {
      try {
        const result = await apiClient.get<{ roles: Array<{ legacyRole: string; name: string; isActive: boolean }> }>('/admin/roles');
        const roles = (result as unknown as { roles?: Array<{ legacyRole: string; name: string; isActive: boolean }> }).roles;
        if (result.success && Array.isArray(roles)) {
          const seen = new Set<string>();
          const opts: Array<{ legacyRole: string; name: string }> = [];
          for (const r of roles) {
            if (!r.isActive || seen.has(r.legacyRole)) continue;
            seen.add(r.legacyRole);
            opts.push({ legacyRole: r.legacyRole, name: r.name });
          }
          if (opts.length > 0) setRoleOptions(opts);
        }
      } catch {
        // keep fallback list
      }
    };
    fetchRoles();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(
    async (targetPage: number) => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({ page: String(targetPage), pageSize: '10', status });
        if (branchId !== 'all') params.set('branchId', branchId);
        if (role !== 'all') params.set('role', role);
        if (debouncedSearch) params.set('search', debouncedSearch);
        const result = await apiClient.get<ListResponse>(`/employees/login-access?${params.toString()}`);
        if (result.success && result.data) {
          setRows(result.data.employees);
          setTotalPages(result.data.totalPages);
          setTotalCount(result.data.totalCount);
          setPage(result.data.page);
        } else {
          toast({ title: 'Error', description: result.error || 'Failed to load employees', variant: 'destructive' });
        }
      } catch {
        toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    },
    [branchId, debouncedSearch, role, status, toast]
  );

  useEffect(() => {
    load(1);
  }, [load]);

  const buildFilterParams = () => {
    const params = new URLSearchParams({ status });
    if (branchId !== 'all') params.set('branchId', branchId);
    if (role !== 'all') params.set('role', role);
    if (debouncedSearch) params.set('search', debouncedSearch);
    return params;
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params = buildFilterParams();
      params.set('all', 'true');
      const result = await apiClient.get<ListResponse>(`/employees/login-access?${params.toString()}`);
      if (!result.success || !result.data) {
        toast({ title: 'Error', description: result.error || 'Export failed', variant: 'destructive' });
        return;
      }
      const data = result.data.employees.map((r) => ({
        'Emp ID': r.employeeId ?? '',
        Name: r.name,
        Role: r.roleName,
        Branch: r.branch ? `${r.branch.name} (${r.branch.code})` : '',
        Account: STATUS_LABEL[r.accountStatus],
        'Web Login': r.accountStatus !== 'ACTIVE' ? 'Blocked' : r.webLoginEnabled ? 'Allowed' : 'Disabled',
        'Mobile Login': r.accountStatus !== 'ACTIVE' ? 'Blocked' : r.mobileLoginEnabled ? 'Allowed' : 'Disabled',
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      ws['!cols'] = [12, 24, 22, 28, 18, 12, 12].map((wch) => ({ wch }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Login Access');
      XLSX.writeFile(wb, `login-access-${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch {
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  const handleToggle = async (
    row: LoginAccessRow,
    field: 'webLoginEnabled' | 'mobileLoginEnabled',
    value: boolean
  ) => {
    const key = `${row.id}:${field}`;
    setSavingKey(key);
    try {
      const result = await apiClient.patch<{ id: string }>('/employees/login-access', {
        userId: row.id,
        [field]: value,
      });
      if (result.success) {
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, [field]: value } : r)));
        toast({
          title: 'Updated',
          description: `${row.name}: ${field === 'webLoginEnabled' ? 'Web' : 'Mobile'} login ${value ? 'enabled' : 'disabled'}`,
        });
      } else {
        toast({ title: 'Error', description: result.error || 'Failed to update', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6 pt-3 sm:pt-4 md:pt-6">
      <div>
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white flex items-center gap-2">
          <MonitorSmartphone className="h-6 w-6" /> Login Access
        </h1>
        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
          Allow or block web and mobile login per employee. Inactive, deleted and exited (HR) employees are always blocked on both.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">Branch</div>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Branches</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Employee</div>
              <Input
                placeholder="Name, employee ID or mobile"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Role</div>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  {roleOptions.map((r) => (
                    <SelectItem key={r.legacyRole} value={r.legacyRole}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Account</div>
              <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="BLOCKED">Inactive / Deleted / Exited</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Employees ({totalCount})</CardTitle>
              <CardDescription>Changes apply within a few seconds, including to signed-in sessions.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={isExporting || totalCount === 0}>
              {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Export Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <PageLoader fullScreen={false} />
          ) : rows.length === 0 ? (
            <p className="text-center py-12 text-sidebar-accent dark:text-slate-400">No employees found.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Emp ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Web</TableHead>
                    <TableHead>Mobile</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const blocked = row.accountStatus !== 'ACTIVE';
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-xs">{row.employeeId || '—'}</TableCell>
                        <TableCell>{row.name}</TableCell>
                        <TableCell>{row.roleName}</TableCell>
                        <TableCell>{row.branch ? `${row.branch.name} (${row.branch.code})` : '—'}</TableCell>
                        <TableCell>
                          <Badge variant={blocked ? 'destructive' : 'outline'}>{STATUS_LABEL[row.accountStatus]}</Badge>
                        </TableCell>
                        {(['webLoginEnabled', 'mobileLoginEnabled'] as const).map((field) => (
                          <TableCell key={field}>
                            {blocked ? (
                              <span className="text-xs text-red-600">Blocked</span>
                            ) : (
                              <Switch
                                checked={row[field]}
                                disabled={savingKey === `${row.id}:${field}`}
                                onCheckedChange={(v) => handleToggle(row, field, v)}
                                className="data-[state=checked]:bg-green-500"
                              />
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-1 py-4 mt-2">
              <p className="text-sm text-sidebar-accent dark:text-slate-400">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={() => load(Math.max(1, page - 1))} disabled={page === 1 || isLoading}>
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => load(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages || isLoading}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
