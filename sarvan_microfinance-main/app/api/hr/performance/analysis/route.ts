import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/performance/analysis — branch-scoped aggregate: average rating
// and goal-completion stats by department/branch.
export async function GET(request: NextRequest) {
    return withAuth(async (_req, user) => {
        try {
            const permittedBranchIds = await getPermittedBranchIds(user);
            const branchFilter = permittedBranchIds ? { branchId: { in: permittedBranchIds } } : {};

            const reviews = await prisma.performanceReview.findMany({
                where: { status: 'ACKNOWLEDGED', employee: branchFilter },
                select: {
                    overallRating: true,
                    employee: {
                        select: {
                            department: { select: { id: true, name: true } },
                            branch: { select: { id: true, name: true } },
                        },
                    },
                },
            });

            const goals = await prisma.performanceGoal.findMany({
                where: { employee: branchFilter },
                select: { status: true },
            });

            const byDepartment = new Map<string, { name: string; total: number; count: number }>();
            const byBranch = new Map<string, { name: string; total: number; count: number }>();

            for (const r of reviews) {
                const dept = r.employee.department;
                if (dept) {
                    const entry = byDepartment.get(dept.id) ?? { name: dept.name, total: 0, count: 0 };
                    entry.total += r.overallRating;
                    entry.count += 1;
                    byDepartment.set(dept.id, entry);
                }
                const branch = r.employee.branch;
                if (branch) {
                    const entry = byBranch.get(branch.id) ?? { name: branch.name, total: 0, count: 0 };
                    entry.total += r.overallRating;
                    entry.count += 1;
                    byBranch.set(branch.id, entry);
                }
            }

            const goalStats = {
                total: goals.length,
                open: goals.filter((g) => g.status === 'OPEN').length,
                achieved: goals.filter((g) => g.status === 'ACHIEVED').length,
                missed: goals.filter((g) => g.status === 'MISSED').length,
                cancelled: goals.filter((g) => g.status === 'CANCELLED').length,
            };

            return successResponse({
                averageRatingByDepartment: Array.from(byDepartment.entries()).map(([id, v]) => ({
                    id, name: v.name, averageRating: Math.round((v.total / v.count) * 100) / 100, reviewCount: v.count,
                })),
                averageRatingByBranch: Array.from(byBranch.entries()).map(([id, v]) => ({
                    id, name: v.name, averageRating: Math.round((v.total / v.count) * 100) / 100, reviewCount: v.count,
                })),
                goalStats,
                totalAcknowledgedReviews: reviews.length,
            }, 'Performance analysis fetched successfully');
        } catch (error: any) {
            console.error('Error fetching performance analysis:', error);
            return errorResponse(error.message || 'Failed to fetch performance analysis', 500);
        }
    })(request);
}
