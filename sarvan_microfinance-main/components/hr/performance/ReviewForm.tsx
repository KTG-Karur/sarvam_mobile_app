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
import { ClipboardCheck, Plus, Send, CheckCircle2 } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

type Employee = { id: string; firstName: string; lastName: string; employeeId: string | null };

type Review = {
    id: string;
    reviewPeriodStart: string;
    reviewPeriodEnd: string;
    overallRating: number;
    comments: string | null;
    status: 'DRAFT' | 'SUBMITTED' | 'ACKNOWLEDGED';
    employee: { id: string; firstName: string; lastName: string; employeeId: string | null };
    reviewer: { id: string; firstName: string; lastName: string };
};

function statusVariant(status: string): 'default' | 'destructive' | 'outline' {
    if (status === 'ACKNOWLEDGED') return 'default';
    return 'outline';
}

export function ReviewForm({ scope = 'self' }: { scope?: 'self' | 'team' }) {
    const { toast } = useToast();
    const [reviews, setReviews] = useState<Review[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    const [employeeId, setEmployeeId] = useState('');
    const [reviewPeriodStart, setReviewPeriodStart] = useState('');
    const [reviewPeriodEnd, setReviewPeriodEnd] = useState('');
    const [overallRating, setOverallRating] = useState('3');
    const [comments, setComments] = useState('');

    const fetchAll = useCallback(async () => {
        try {
            const qs = scope === 'team' ? '?scope=team' : '';
            const [reviewsRes, employeesRes] = await Promise.all([
                apiClient.get<Review[]>(`/hr/performance/reviews${qs}`),
                scope === 'team' ? apiClient.get<Employee[]>('/hr/employees') : Promise.resolve(null),
            ]);
            if (reviewsRes.success && reviewsRes.data) setReviews(reviewsRes.data);
            if (employeesRes?.success && employeesRes.data) setEmployees(employeesRes.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch performance reviews.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [scope, toast]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const handleCreate = async () => {
        try {
            const res = await apiClient.post('/hr/performance/reviews', {
                employeeId, reviewPeriodStart, reviewPeriodEnd,
                overallRating: Number(overallRating), comments: comments || null,
            });
            if (res.success) {
                toast({ title: 'Created', description: 'Draft review created.' });
                setIsCreateOpen(false);
                setEmployeeId(''); setReviewPeriodStart(''); setReviewPeriodEnd(''); setOverallRating('3'); setComments('');
                await fetchAll();
            } else {
                throw new Error(res.error || 'Creation failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Creation failed.', variant: 'destructive' });
        }
    };

    const handleSubmitReview = async (review: Review) => {
        try {
            const res = await apiClient.patch(`/hr/performance/reviews/${review.id}`, { action: 'submit' });
            if (res.success) {
                toast({ title: 'Submitted', description: 'Review submitted to employee.' });
                await fetchAll();
            } else {
                throw new Error(res.error || 'Submission failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Submission failed.', variant: 'destructive' });
        }
    };

    const handleAcknowledge = async (review: Review) => {
        try {
            const res = await apiClient.patch(`/hr/performance/reviews/${review.id}`, { action: 'acknowledge' });
            if (res.success) {
                toast({ title: 'Acknowledged', description: 'Review acknowledged.' });
                await fetchAll();
            } else {
                throw new Error(res.error || 'Acknowledgement failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Acknowledgement failed.', variant: 'destructive' });
        }
    };

    if (isLoading) {
        return <PageLoader label="Loading Reviews..." fullScreen={false} />;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-5xl space-y-6">
                <div className="mb-8 flex items-center justify-between mt-4">
                    <div className="flex items-center gap-4">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <ClipboardCheck className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                {scope === 'team' ? 'Team Performance Reviews' : 'My Performance Reviews'}
                            </h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">Review period, overall rating and comments.</p>
                        </div>
                    </div>
                    {scope === 'team' && (
                        <Button onClick={() => setIsCreateOpen(true)} className="bg-primary text-white">
                            <Plus className="h-4 w-4 mr-2" />
                            New Review
                        </Button>
                    )}
                </div>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                        {scope === 'team' ? <TableHead>Employee</TableHead> : <TableHead>Reviewer</TableHead>}
                                        <TableHead>Period</TableHead>
                                        <TableHead>Rating</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-center">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {reviews.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="px-4 py-12 text-center text-slate-500">No reviews yet.</TableCell>
                                        </TableRow>
                                    ) : (
                                        reviews.map((review) => (
                                            <TableRow key={review.id}>
                                                <TableCell className="text-sm">
                                                    {scope === 'team'
                                                        ? `${review.employee.firstName} ${review.employee.lastName}`
                                                        : `${review.reviewer.firstName} ${review.reviewer.lastName}`}
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    {toDisplayDate(new Date(review.reviewPeriodStart))} — {toDisplayDate(new Date(review.reviewPeriodEnd))}
                                                </TableCell>
                                                <TableCell className="text-sm font-semibold">{review.overallRating} / 5</TableCell>
                                                <TableCell><Badge variant={statusVariant(review.status)}>{review.status}</Badge></TableCell>
                                                <TableCell className="text-center">
                                                    {scope === 'team' && review.status === 'DRAFT' && (
                                                        <Button size="sm" variant="ghost" onClick={() => handleSubmitReview(review)} title="Submit">
                                                            <Send className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                    {scope === 'self' && review.status === 'SUBMITTED' && (
                                                        <Button size="sm" variant="ghost" className="text-green-600" onClick={() => handleAcknowledge(review)} title="Acknowledge">
                                                            <CheckCircle2 className="h-4 w-4" />
                                                        </Button>
                                                    )}
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
                    <DialogHeader><DialogTitle>New Performance Review</DialogTitle></DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Employee</Label>
                            <Select value={employeeId} onValueChange={setEmployeeId}>
                                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                                <SelectContent>
                                    {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Period Start</Label>
                                <DateInput value={reviewPeriodStart} onChange={(e) => setReviewPeriodStart(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label>Period End</Label>
                                <DateInput value={reviewPeriodEnd} onChange={(e) => setReviewPeriodEnd(e.target.value)} />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Overall Rating (1-5)</Label>
                            <Select value={overallRating} onValueChange={setOverallRating}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Comments</Label>
                            <Input value={comments} onChange={(e) => setComments(e.target.value)} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                        <Button onClick={handleCreate} disabled={!employeeId || !reviewPeriodStart || !reviewPeriodEnd}>Save Draft</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
