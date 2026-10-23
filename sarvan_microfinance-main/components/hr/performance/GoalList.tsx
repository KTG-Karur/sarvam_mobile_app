'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Target, Plus } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

type Employee = { id: string; firstName: string; lastName: string; employeeId: string | null };

type Goal = {
    id: string;
    title: string;
    description: string | null;
    targetDate: string;
    targetMetric: string | null;
    status: 'OPEN' | 'ACHIEVED' | 'MISSED' | 'CANCELLED';
    employee: { id: string; firstName: string; lastName: string; employeeId: string | null };
};

function statusVariant(status: string): 'default' | 'destructive' | 'outline' {
    if (status === 'ACHIEVED') return 'default';
    if (status === 'MISSED' || status === 'CANCELLED') return 'destructive';
    return 'outline';
}

export function GoalList({ scope = 'self' }: { scope?: 'self' | 'team' }) {
    const { toast } = useToast();
    const [goals, setGoals] = useState<Goal[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    const [employeeId, setEmployeeId] = useState('');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [targetDate, setTargetDate] = useState('');
    const [targetMetric, setTargetMetric] = useState('');

    const fetchAll = useCallback(async () => {
        try {
            const qs = scope === 'team' ? '?scope=team' : '';
            const [goalsRes, employeesRes] = await Promise.all([
                apiClient.get<Goal[]>(`/hr/performance/goals${qs}`),
                scope === 'team' ? apiClient.get<Employee[]>('/hr/employees') : Promise.resolve(null),
            ]);
            if (goalsRes.success && goalsRes.data) setGoals(goalsRes.data);
            if (employeesRes?.success && employeesRes.data) setEmployees(employeesRes.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch performance goals.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [scope, toast]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const handleCreate = async () => {
        try {
            const res = await apiClient.post('/hr/performance/goals', {
                employeeId: scope === 'team' ? employeeId : undefined,
                title, description: description || null, targetDate, targetMetric: targetMetric || null,
            });
            if (res.success) {
                toast({ title: 'Created', description: 'Performance goal created.' });
                setIsCreateOpen(false);
                setEmployeeId(''); setTitle(''); setDescription(''); setTargetDate(''); setTargetMetric('');
                await fetchAll();
            } else {
                throw new Error(res.error || 'Creation failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Creation failed.', variant: 'destructive' });
        }
    };

    const handleStatusChange = async (goal: Goal, status: Goal['status']) => {
        try {
            const res = await apiClient.patch(`/hr/performance/goals/${goal.id}`, { status });
            if (res.success) {
                await fetchAll();
            } else {
                throw new Error(res.error || 'Update failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Update failed.', variant: 'destructive' });
        }
    };

    if (isLoading) {
        return <PageLoader label="Loading Goals..." fullScreen={false} />;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-5xl space-y-6">
                <div className="mb-8 flex items-center justify-between mt-4">
                    <div className="flex items-center gap-4">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <Target className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                {scope === 'team' ? 'Team Performance Goals' : 'My Performance Goals'}
                            </h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">Track goals with target dates and metrics.</p>
                        </div>
                    </div>
                    <Button onClick={() => setIsCreateOpen(true)} className="bg-primary text-white">
                        <Plus className="h-4 w-4 mr-2" />
                        New Goal
                    </Button>
                </div>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                        {scope === 'team' && <TableHead>Employee</TableHead>}
                                        <TableHead>Title</TableHead>
                                        <TableHead>Target Metric</TableHead>
                                        <TableHead>Target Date</TableHead>
                                        <TableHead>Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {goals.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={scope === 'team' ? 5 : 4} className="px-4 py-12 text-center text-slate-500">No goals yet.</TableCell>
                                        </TableRow>
                                    ) : (
                                        goals.map((goal) => (
                                            <TableRow key={goal.id}>
                                                {scope === 'team' && (
                                                    <TableCell className="text-sm">{goal.employee.firstName} {goal.employee.lastName}</TableCell>
                                                )}
                                                <TableCell className="text-sm font-medium">{goal.title}</TableCell>
                                                <TableCell className="text-sm">{goal.targetMetric || '—'}</TableCell>
                                                <TableCell className="text-sm">{toDisplayDate(new Date(goal.targetDate))}</TableCell>
                                                <TableCell>
                                                    <Select value={goal.status} onValueChange={(v) => handleStatusChange(goal, v as Goal['status'])}>
                                                        <SelectTrigger className="w-32 h-8">
                                                            <SelectValue>
                                                                <Badge variant={statusVariant(goal.status)}>{goal.status}</Badge>
                                                            </SelectValue>
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="OPEN">OPEN</SelectItem>
                                                            <SelectItem value="ACHIEVED">ACHIEVED</SelectItem>
                                                            <SelectItem value="MISSED">MISSED</SelectItem>
                                                            <SelectItem value="CANCELLED">CANCELLED</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>New Performance Goal</DialogTitle></DialogHeader>
                    <div className="space-y-4 py-2">
                        {scope === 'team' && (
                            <div className="space-y-2">
                                <Label>Employee</Label>
                                <Select value={employeeId} onValueChange={setEmployeeId}>
                                    <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                                    <SelectContent>
                                        {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label>Title</Label>
                            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Target Metric (optional)</Label>
                            <Input value={targetMetric} onChange={(e) => setTargetMetric(e.target.value)} placeholder="e.g. 95% collection rate" />
                        </div>
                        <div className="space-y-2">
                            <Label>Target Date</Label>
                            <DateInput value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Description (optional)</Label>
                            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                        <Button onClick={handleCreate} disabled={!title || !targetDate || (scope === 'team' && !employeeId)}>Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
