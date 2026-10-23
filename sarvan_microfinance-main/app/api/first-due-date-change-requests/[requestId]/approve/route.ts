import { NextRequest } from 'next/server';
import * as z from 'zod';
import { prisma } from '@/app/lib/prisma';
import { errorResponse, handleCorsPreflight, successResponse, withAuth } from '@/app/lib/api-utils';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { meetingDayError } from '@/app/lib/first-due-date-meeting-day';

const approveSchema = z.object({
  newFirstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'newFirstDueDate must be YYYY-MM-DD'),
  remarks: z.string().trim().max(500).optional(),
});

class NoEligibleLoansError extends Error {}

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * POST /api/first-due-date-change-requests/{requestId}/approve
 * Admin / Sub Admin picks the new date; applied to every still-undisbursed
 * (APPROVED_LEVEL2) loan of the index. Any date is allowed except one before
 *  the index creation date, and it must fall on the center's meeting day.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { requestId } = await params;
  return withAuth(async (req, user) => {
    try {
      if (user.role !== 'ADMIN' && !(await isSubAdminUser(user.userId))) {
        return errorResponse('Insufficient permissions', 403);
      }
      const { newFirstDueDate, remarks } = approveSchema.parse(await req.json());
      // UTC midnight of the Y-M-D string — same storage as loan-indexes/[indexId]/approve
      const newDate = new Date(newFirstDueDate);
      if (Number.isNaN(newDate.getTime()) || newDate.toISOString().slice(0, 10) !== newFirstDueDate) {
        return errorResponse('Invalid date', 400);
      }

      const record = await prisma.firstDueDateChangeRequest.findUnique({
        where: { id: requestId },
        select: {
          id: true,
          indexId: true,
          branchId: true,
          index: { select: { indexDate: true, frequency: true, center: { select: { meetingDay: true } } } },
        },
      });
      if (!record) return errorResponse('Request not found', 404);

      const permittedBranchIds = await getPermittedBranchIds(user);
      if (permittedBranchIds !== null && !permittedBranchIds.includes(record.branchId)) {
        return errorResponse('You do not have access to this branch', 403);
      }

      if (newFirstDueDate < record.index.indexDate.toISOString().slice(0, 10)) {
        return errorResponse('First due date cannot be before the index creation date', 400);
      }

      // Same rule bm-disburse enforces: first due date must fall on the center's meeting day.
      const dayError = meetingDayError(newFirstDueDate, record.index.center.meetingDay, record.index.frequency);
      if (dayError) return errorResponse(dayError, 400);

      let updatedLoans = 0;
      try {
        await prisma.$transaction(async (tx) => {
          // Claim inside the transaction so two approvers cannot both apply it.
          const claimed = await tx.firstDueDateChangeRequest.updateMany({
            where: { id: requestId, status: 'PENDING' },
            data: {
              status: 'APPROVED',
              newFirstDueDate: newDate,
              decidedById: user.userId,
              decidedAt: new Date(),
              decisionRemarks: remarks || null,
            },
          });
          if (claimed.count === 0) throw new RequestNotPendingError();

          const updated = await tx.loan.updateMany({
            where: { indexId: record.indexId, isActive: true, disbursementStatus: 'APPROVED_LEVEL2' },
            data: { firstDueDate: newDate },
          });
          // Index disbursed / reverted meanwhile — throwing rolls the claim back too.
          if (updated.count === 0) throw new NoEligibleLoansError();
          updatedLoans = updated.count;
        });
      } catch (e) {
        if (e instanceof RequestNotPendingError) return errorResponse('Request is no longer pending', 409);
        if (e instanceof NoEligibleLoansError) {
          return errorResponse('No loans in this index are pending final disbursement any more', 400);
        }
        throw e;
      }

      return successResponse({ id: requestId, status: 'APPROVED', updatedLoans }, 'First due date updated');
    } catch (error) {
      if (error instanceof z.ZodError) return errorResponse(error.issues[0].message, 400);
      console.error('Error approving first due date change request:', error);
      return errorResponse(error instanceof Error ? error.message : 'Failed to approve request', 500);
    }
  })(request);
}

class RequestNotPendingError extends Error {}
