import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { isWithinRevertWindow } from '@/app/lib/uploan-import-revert-gate';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/uploan/member/import/jobs
 * Paginated list of past uploan import jobs — powers the "Import History" page.
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
            const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));

            const [totalCount, jobs] = await Promise.all([
                prisma.uploanImportJob.count(),
                prisma.uploanImportJob.findMany({
                    orderBy: { createdAt: 'desc' },
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                    include: {
                        branch: { select: { name: true, code: true } },
                        createdBy: { select: { firstName: true, lastName: true } },
                        revertedBy: { select: { firstName: true, lastName: true } },
                    },
                }),
            ]);

            const jobIds = jobs.map((j) => j.id);
            const statusCounts = jobIds.length > 0
                ? await prisma.uploanImportJobRow.groupBy({
                    by: ['jobId', 'status'],
                    where: { jobId: { in: jobIds } },
                    _count: true,
                })
                : [];

            const countsByJobId = new Map<string, Record<string, number>>();
            for (const row of statusCounts) {
                const existing = countsByJobId.get(row.jobId) ?? {};
                existing[row.status] = row._count;
                countsByJobId.set(row.jobId, existing);
            }

            const data = jobs.map((job) => {
                const counts = countsByJobId.get(job.id) ?? {};
                return {
                    id: job.id,
                    branchName: job.branch.name,
                    branchCode: job.branch.code,
                    createdByName: `${job.createdBy.firstName} ${job.createdBy.lastName}`,
                    status: job.status,
                    totalRows: job.totalRows,
                    createdCount: counts.CREATED ?? 0,
                    failedCount: counts.FAILED ?? 0,
                    revertedCount: counts.REVERTED ?? 0,
                    revertFailedCount: counts.REVERT_FAILED ?? 0,
                    createdAt: job.createdAt,
                    completedAt: job.completedAt,
                    canRevert: job.status === 'COMPLETED' && job.completedAt !== null && isWithinRevertWindow(job.completedAt),
                    revertReason: job.revertReason,
                    revertedAt: job.revertedAt,
                    revertedByName: job.revertedBy ? `${job.revertedBy.firstName} ${job.revertedBy.lastName}` : null,
                };
            });

            return successResponse({
                jobs: data,
                totalCount,
                totalPages: Math.ceil(totalCount / pageSize),
                page,
                pageSize,
            });
        } catch (error) {
            console.error('[uploan import/jobs] Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch import jobs', 500);
        }
    })(request);
}
