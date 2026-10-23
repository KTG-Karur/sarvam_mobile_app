'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { BarChart3 } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';

type RatingGroup = { id: string; name: string; averageRating: number; reviewCount: number };
type Analysis = {
    averageRatingByDepartment: RatingGroup[];
    averageRatingByBranch: RatingGroup[];
    goalStats: { total: number; open: number; achieved: number; missed: number; cancelled: number };
    totalAcknowledgedReviews: number;
};

function RatingBar({ group }: { group: RatingGroup }) {
    const pct = (group.averageRating / 5) * 100;
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{group.name}</span>
                <span className="text-slate-500">{group.averageRating.toFixed(2)} / 5 ({group.reviewCount})</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 dark:bg-sidebar-accent overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

export function PerformanceAnalysis() {
    const { toast } = useToast();
    const [analysis, setAnalysis] = useState<Analysis | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const fetchAnalysis = useCallback(async () => {
        try {
            const res = await apiClient.get<Analysis>('/hr/performance/analysis');
            if (res.success && res.data) setAnalysis(res.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch performance analysis.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchAnalysis();
    }, [fetchAnalysis]);

    if (isLoading) {
        return <PageLoader label="Loading Performance Analysis..." fullScreen={false} />;
    }

    if (!analysis) {
        return <div className="mx-auto max-w-3xl py-12 text-center text-slate-500">No data available.</div>;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-5xl space-y-6">
                <div className="mb-8 flex items-center gap-4 mt-4">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <BarChart3 className="h-7 w-7 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">Performance Analysis</h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">Average ratings and goal completion across your scope.</p>
                    </div>
                </div>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                        <CardTitle className="text-lg font-semibold text-white">Goal Completion</CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
                        <div><div className="text-2xl font-bold">{analysis.goalStats.total}</div><div className="text-xs text-slate-500">Total</div></div>
                        <div><div className="text-2xl font-bold text-slate-500"><Badge variant="outline">{analysis.goalStats.open}</Badge></div><div className="text-xs text-slate-500">Open</div></div>
                        <div><div className="text-2xl font-bold text-green-600"><Badge>{analysis.goalStats.achieved}</Badge></div><div className="text-xs text-slate-500">Achieved</div></div>
                        <div><div className="text-2xl font-bold text-red-600"><Badge variant="destructive">{analysis.goalStats.missed}</Badge></div><div className="text-xs text-slate-500">Missed</div></div>
                        <div><div className="text-2xl font-bold text-slate-400"><Badge variant="outline">{analysis.goalStats.cancelled}</Badge></div><div className="text-xs text-slate-500">Cancelled</div></div>
                    </CardContent>
                </Card>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                        <CardTitle className="text-lg font-semibold text-white">Average Rating by Department</CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 space-y-4">
                        {analysis.averageRatingByDepartment.length === 0 ? (
                            <p className="text-sm text-slate-500">No acknowledged reviews yet.</p>
                        ) : (
                            analysis.averageRatingByDepartment.map((g) => <RatingBar key={g.id} group={g} />)
                        )}
                    </CardContent>
                </Card>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                        <CardTitle className="text-lg font-semibold text-white">Average Rating by Branch</CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 space-y-4">
                        {analysis.averageRatingByBranch.length === 0 ? (
                            <p className="text-sm text-slate-500">No acknowledged reviews yet.</p>
                        ) : (
                            analysis.averageRatingByBranch.map((g) => <RatingBar key={g.id} group={g} />)
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
