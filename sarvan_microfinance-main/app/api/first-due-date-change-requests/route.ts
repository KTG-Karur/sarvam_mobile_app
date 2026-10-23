import { NextRequest } from 'next/server';
import * as z from 'zod';
import { prisma } from '@/app/lib/prisma';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';

const listQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  branchId: z.string().min(1).optional(),
  indexId: z.string().min(1).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

const createSchema = z.object({
  indexId: z.string().min(1, 'indexId is required'),
  reason: z.string().trim().min(5, 'Reason must be at least 5 characters').max(500),
});

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * GET /api/first-due-date-change-requests
 * Admin / Sub Admin: all permitted branches (approvals page).
 * Branch Manager: own permitted branches only (pending badge on Final Disbursement).
 */
export async function GET(request: NextRequest) {
  return withAuth(async (req, user) => {
    try {
      const isApprover = user.role === 'ADMIN' || (await isSubAdminUser(user.userId));
      if (!isApprover && user.role !== 'BRANCH_MANAGER') {
        return errorResponse('Insufficient permissions', 403);
      }

      const { searchParams } = new URL(req.url);
      const parsed = listQuerySchema.safeParse(Object.fromEntries(searchParams.entries()));
      if (!parsed.success) {
        return errorResponse(parsed.error.issues.map((i) => i.message).join(', '), 400);
      }
      const { status, branchId, indexId, from, to, page, pageSize } = parsed.data;

      const permittedBranchIds = await getPermittedBranchIds(user);
      if (permittedBranchIds !== null && branchId && !permittedBranchIds.includes(branchId)) {
        return errorResponse('You do not have access to this branch', 403);
      }

      const where: Record<string, unknown> = {
        ...(status ? { status } : {}),
        ...(indexId ? { indexId } : {}),
        // Raised-date range, day boundaries in IST (Asia/Kolkata)
        ...(from || to
          ? {
              requestedAt: {
                ...(from ? { gte: new Date(`${from}T00:00:00+05:30`) } : {}),
                ...(to ? { lte: new Date(`${to}T23:59:59.999+05:30`) } : {}),
              },
            }
          : {}),
        ...(branchId
          ? { branchId }
          : permittedBranchIds !== null
            ? { branchId: { in: permittedBranchIds } }
            : {}),
      };

      const userSelect = { id: true, firstName: true, lastName: true };
      const [totalCount, requests] = await Promise.all([
        prisma.firstDueDateChangeRequest.count({ where }),
        prisma.firstDueDateChangeRequest.findMany({
          where,
          orderBy: { requestedAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            indexId: true,
            oldFirstDueDate: true,
            newFirstDueDate: true,
            reason: true,
            status: true,
            requestedAt: true,
            decidedAt: true,
            decisionRemarks: true,
            branch: { select: { id: true, name: true } },
            index: {
              select: {
                indexNo: true,
                indexDate: true,
                totalApps: true,
                totalAmount: true,
                frequency: true,
                center: { select: { name: true, meetingDay: true } },
              },
            },
            requestedBy: { select: userSelect },
            decidedBy: { select: userSelect },
          },
        }),
      ]);

      return successResponse(
        {
          requests: requests.map((r) => ({
            id: r.id,
            indexId: r.indexId,
            indexNo: r.index.indexNo,
            indexDate: r.index.indexDate.toISOString(),
            centerName: r.index.center.name,
            meetingDay: r.index.center.meetingDay,
            frequency: r.index.frequency,
            totalApps: r.index.totalApps,
            totalAmount: Number(r.index.totalAmount),
            branch: r.branch,
            oldFirstDueDate: r.oldFirstDueDate?.toISOString() ?? null,
            newFirstDueDate: r.newFirstDueDate?.toISOString() ?? null,
            reason: r.reason,
            status: r.status,
            requestedAt: r.requestedAt.toISOString(),
            requestedBy: r.requestedBy,
            decidedAt: r.decidedAt?.toISOString() ?? null,
            decidedBy: r.decidedBy,
            decisionRemarks: r.decisionRemarks,
          })),
          totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
          page,
          pageSize,
        },
        'First due date change requests fetched successfully'
      );
    } catch (error) {
      console.error('Error fetching first due date change requests:', error);
      return errorResponse('Failed to fetch first due date change requests', 500);
    }
  })(request);
}

/**
 * POST /api/first-due-date-change-requests
 * BM / Admin / Sub Admin raises a change request for a whole Loan Index that is in final disbursement.
 * The BM gives a reason only — the approver picks the new date.
 */
export async function POST(request: NextRequest) {
  return withAuth(async (req, user) => {
    try {
      if (user.role !== 'BRANCH_MANAGER' && user.role !== 'ADMIN' && !(await isSubAdminUser(user.userId))) {
        return errorResponse('Insufficient permissions', 403);
      }
      const { indexId, reason } = createSchema.parse(await req.json());

      const index = await prisma.loanIndex.findUnique({
        where: { id: indexId },
        select: { id: true, branchId: true, isActive: true },
      });
      if (!index || !index.isActive) return errorResponse('Loan index not found', 404);

      const permittedBranchIds = await getPermittedBranchIds(user);
      if (permittedBranchIds !== null && !permittedBranchIds.includes(index.branchId)) {
        return errorResponse('This index does not belong to your branch', 403);
      }

      const created = await prisma.$transaction(async (tx): Promise<{ error: string } | { request: { id: string; status: string } }> => {
        const loans = await tx.loan.findMany({
          where: { indexId, isActive: true, disbursementStatus: 'APPROVED_LEVEL2' },
          select: { firstDueDate: true },
        });
        if (loans.length === 0) {
          return { error: 'No loans in this index are pending final disbursement' };
        }

        const existing = await tx.firstDueDateChangeRequest.findFirst({
          where: { indexId, status: 'PENDING' },
          select: { id: true },
        });
        if (existing) {
          return { error: 'A first due date change request is already pending for this index' };
        }

        const request = await tx.firstDueDateChangeRequest.create({
          data: {
            indexId,
            branchId: index.branchId,
            oldFirstDueDate: loans.find((l) => l.firstDueDate)?.firstDueDate ?? null,
            reason,
            requestedById: user.userId,
          },
          select: { id: true, status: true },
        });
        return { request };
      });

      if ('error' in created) return errorResponse(created.error, 409);
      return successResponse(created.request, 'First due date change requested');
    } catch (error) {
      if (error instanceof z.ZodError) return errorResponse(error.issues[0].message, 400);
      console.error('Error creating first due date change request:', error);
      return errorResponse(error instanceof Error ? error.message : 'Failed to create request', 500);
    }
  })(request);
}
