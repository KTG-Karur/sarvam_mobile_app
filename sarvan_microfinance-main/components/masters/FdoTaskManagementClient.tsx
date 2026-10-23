'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Download, Upload, RefreshCw, Check, X, Pencil } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';

interface FdoTask {
  id: string;
  userId: string;
  employeeId: string | null;
  name: string;
  branch: string;
  enrollmentTarget: number;
  newMemberTarget: number;
  renewalMemberTarget: number;
  loanDisbursementTarget: number;
}

interface EditingValues {
  enrollmentTarget: string;
  newMemberTarget: string;
  renewalMemberTarget: string;
  loanDisbursementTarget: string;
}

interface UploadResult {
  totalUploaded: number;
  totalCreated: number;
  totalUpdated: number;
  totalFailed: number;
}

export function FdoTaskManagementClient() {
  const { toast } = useToast();
  const [month, setMonth] = useState<string>(String(new Date().getMonth() + 1));
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [tasks, setTasks] = useState<FdoTask[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValues, setEditingValues] = useState<EditingValues>({
    enrollmentTarget: '',
    newMemberTarget: '',
    renewalMemberTarget: '',
    loanDisbursementTarget: '',
  });

  const months = Array.from({ length: 12 }, (_, i) => ({
    label: new Date(2000, i, 1).toLocaleString('default', { month: 'long' }),
    value: String(i + 1),
  }));

  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - 2 + i));

  const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(tasks);

  const handleLoadTasks = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/fdo-tasks?month=${month}&year=${year}`);
      const result = await response.json();

      if (response.ok && result.data) {
        setTasks(result.data);
        toast({ title: 'Success', description: 'FDO tasks loaded successfully.' });
      } else {
        toast({ title: 'Error', description: result.message || 'Failed to load tasks.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load FDO tasks.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch(`/api/fdo-tasks/template?month=${month}&year=${year}`);
      if (!response.ok) throw new Error('Failed to download template');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `FDO_Targets_${month}_${year}.xlsx`;
      link.click();
      window.URL.revokeObjectURL(url);
      toast({ title: 'Downloaded', description: 'Template downloaded successfully.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to download template.', variant: 'destructive' });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`/api/fdo-tasks?month=${month}&year=${year}`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        const r = result.data as UploadResult;
        toast({
          title: 'Upload Successful',
          description: `Uploaded: ${r.totalUploaded}, Created: ${r.totalCreated}, Updated: ${r.totalUpdated}, Failed: ${r.totalFailed}`,
        });
        await handleLoadTasks();
      } else {
        toast({ title: 'Upload Failed', description: result.error || 'Failed to upload file.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to upload file.', variant: 'destructive' });
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleEditStart = (task: FdoTask) => {
    setEditingId(task.id);
    setEditingValues({
      enrollmentTarget: String(task.enrollmentTarget),
      newMemberTarget: String(task.newMemberTarget),
      renewalMemberTarget: String(task.renewalMemberTarget),
      loanDisbursementTarget: String(task.loanDisbursementTarget),
    });
  };

  const handleEditCancel = () => {
    setEditingId(null);
  };

  const handleEditSave = async (task: FdoTask) => {
    if (!task.employeeId) {
      toast({ title: 'Error', description: 'Cannot update task without employee ID.', variant: 'destructive' });
      return;
    }

    const enrollmentTarget = parseInt(editingValues.enrollmentTarget, 10);
    const newMemberTarget = parseInt(editingValues.newMemberTarget, 10);
    const renewalMemberTarget = parseInt(editingValues.renewalMemberTarget, 10);
    const loanDisbursementTarget = parseFloat(editingValues.loanDisbursementTarget);

    if ([enrollmentTarget, newMemberTarget, renewalMemberTarget].some((v) => isNaN(v) || v < 0)) {
      toast({ title: 'Error', description: 'Member targets must be valid non-negative numbers.', variant: 'destructive' });
      return;
    }

    try {
      const response = await fetch('/api/fdo-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: task.employeeId,
          month: parseInt(month, 10),
          year: parseInt(year, 10),
          enrollmentTarget,
          newMemberTarget,
          renewalMemberTarget,
          loanDisbursementTarget: isNaN(loanDisbursementTarget) ? 0 : loanDisbursementTarget,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id
              ? { ...t, enrollmentTarget, newMemberTarget, renewalMemberTarget, loanDisbursementTarget: isNaN(loanDisbursementTarget) ? 0 : loanDisbursementTarget }
              : t
          )
        );
        setEditingId(null);
        toast({ title: 'Success', description: 'Targets updated successfully.' });
      } else {
        toast({ title: 'Error', description: result.error || 'Failed to update targets.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to update targets.', variant: 'destructive' });
    }
  };

  const fmtAmount = (v: number) =>
    v >= 100000
      ? `₹${(v / 100000).toFixed(1)}L`
      : v >= 1000
      ? `₹${(v / 1000).toFixed(1)}K`
      : `₹${v}`;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">FDO Task Management</h1>
        <p className="text-sidebar-accent mt-2">Manage monthly targets for Field Development Officers</p>
      </div>

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Task Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">Month</label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Year</label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={y}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 items-end">
              <Button onClick={handleLoadTasks} disabled={isLoading} className="flex-1">
                {isLoading && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
                Load
              </Button>
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <label className="text-sm font-medium block">Import / Export</label>
            <div className="flex gap-2 flex-wrap">
              <Button onClick={handleDownloadTemplate} variant="outline" className="flex-1 min-w-[200px]">
                <Download className="h-4 w-4 mr-2" />
                Download Template
              </Button>
              <div className="flex-1 min-w-[200px]">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                  className="hidden"
                  id="file-input"
                />
                <Button asChild variant="outline" className="cursor-pointer w-full">
                  <label htmlFor="file-input">
                    <Upload className="h-4 w-4 mr-2" />
                    {isUploading ? 'Uploading...' : 'Upload Excel'}
                  </label>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tasks Table */}
      {tasks.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap space-y-0">
            <div>
              <CardTitle>FDO Targets</CardTitle>
              <CardDescription>
                {months.find((m) => m.value === month)?.label} {year}
              </CardDescription>
            </div>
            <TableSearchInput
              value={tableSearchQuery}
              onChange={setTableSearchQuery}
              placeholder="Search FDO targets..."
            />
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-brand-green-tint">
                    <TableHead className="font-bold">#</TableHead>
                    <TableHead className="font-bold">Employee ID</TableHead>
                    <TableHead className="font-bold">Name</TableHead>
                    <TableHead className="font-bold">Branch</TableHead>
                    <TableHead className="font-bold text-right">Enr. Target</TableHead>
                    <TableHead className="font-bold text-right">New Member</TableHead>
                    <TableHead className="font-bold text-right">Renewal</TableHead>
                    <TableHead className="font-bold text-right">Disbmt Target</TableHead>
                    <TableHead className="font-bold text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {searchedRows.map((task, idx) => (
                    <TableRow key={task.id}>
                      <TableCell className="font-medium">{idx + 1}</TableCell>
                      <TableCell>{task.employeeId || '—'}</TableCell>
                      <TableCell className="font-medium">{task.name}</TableCell>
                      <TableCell>{task.branch}</TableCell>

                      {editingId === task.id ? (
                        <>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              value={editingValues.enrollmentTarget}
                              onChange={(e) => setEditingValues((v) => ({ ...v, enrollmentTarget: e.target.value }))}
                              min="0"
                              className="w-20 text-right"
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              value={editingValues.newMemberTarget}
                              onChange={(e) => setEditingValues((v) => ({ ...v, newMemberTarget: e.target.value }))}
                              min="0"
                              className="w-20 text-right"
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              value={editingValues.renewalMemberTarget}
                              onChange={(e) => setEditingValues((v) => ({ ...v, renewalMemberTarget: e.target.value }))}
                              min="0"
                              className="w-20 text-right"
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              value={editingValues.loanDisbursementTarget}
                              onChange={(e) => setEditingValues((v) => ({ ...v, loanDisbursementTarget: e.target.value }))}
                              min="0"
                              className="w-28 text-right"
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex gap-1 justify-center">
                              <Button size="sm" onClick={() => handleEditSave(task)} className="px-2">
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="outline" onClick={handleEditCancel} className="px-2">
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell className="text-right">{task.enrollmentTarget}</TableCell>
                          <TableCell className="text-right">{task.newMemberTarget}</TableCell>
                          <TableCell className="text-right">{task.renewalMemberTarget}</TableCell>
                          <TableCell className="text-right">{fmtAmount(task.loanDisbursementTarget)}</TableCell>
                          <TableCell className="text-center">
                            <Button size="sm" variant="outline" onClick={() => handleEditStart(task)}>
                              <Pencil className="h-3 w-3 mr-1" />Edit
                            </Button>
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {tasks.length === 0 && !isLoading && (
        <Card>
          <CardContent className="py-12">
            <p className="text-center text-slate-500">No FDO tasks loaded. Select a month and year, then click Load.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
