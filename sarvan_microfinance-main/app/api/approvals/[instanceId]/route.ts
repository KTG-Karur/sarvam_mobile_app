// ============================================================
// APPROVAL ACTION ENDPOINT
// app/api/approvals/[instanceId]/route.ts
//
// Used by approvers to take action on an approval instance
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { requireAuth, isUserContext } from '@/app/lib/permissions/guards';
import {
  processStageAction,
  getWorkflowStatus,
  reopenWorkflow,
} from '@/app/lib/approval/engine';

const ActionSchema = z.object({
  action: z.enum(['approve', 'reject', 'send_back', 'request_info', 'reopen']),
  remarks: z.string().optional(),
});

// This route calls processStageAction() directly — the same generic engine
// call every module's own dedicated action route uses — but with zero
// awareness of what any specific module needs to happen alongside a stage
// transition. Most modules don't need anything extra. These two do: onboarding
// provisions the actual employee User (Employee ID, password, full profile
// copy) the moment its final stage is approved, and transfer syncs the
// employee's branchId the same way. Skip either dedicated route — e.g. by
// hitting this one instead — and the engine still marks the instance
// APPROVED/REJECTED/etc, but the real-world side effect never happens: an
// onboarding request with a fully "APPROVED" instance and no employee ever
// created, un-re-approvable forever since the engine already considers it
// done. (This is exactly how EMP-789/Arun's request got stuck — a Final
// Approval went through this route instead of the onboarding one.)
// Blocking every action here (not just the final-stage approve) is
// deliberate: an intermediate approve/send_back/reject on either module also
// writes back to that module's own status field in its dedicated route, so
// there's no subset of actions on these two record types that's actually
// safe to let this generic route touch.
//
// The same is true of Promotion (designation/role/CTC change + letter),
// Confirmation (confirmationDate + letter) and Exit (employee deactivation +
// relieving letter): each one's own approve/reject route applies the real
// change AND keeps the record's status in step with the instance. Going
// through here instead leaves an APPROVED/REJECTED instance next to a record
// still showing PENDING, with the change never applied.
const MODULE_SPECIFIC_RECORD_TYPES = new Set([
  'EmployeeOnboardingRequest',
  'EmployeeTransfer',
  'EmployeePromotion',
  'EmployeeExitRequest',
  'hr_confirmation',
  'EmployeeConfirmation',
]);

// GET — Get workflow status
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const { instanceId } = await params;
  const result = await requireAuth(request);
  if (!isUserContext(result)) return result;

  try {
    const status = await getWorkflowStatus(instanceId);
    return NextResponse.json({ success: true, ...status });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 404 }
    );
  }
}

// POST — Take action on approval
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const { instanceId } = await params;
  const result = await requireAuth(request);
  if (!isUserContext(result)) return result;

  const body = await request.json();
  const parsed = ActionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const ipAddress = request.headers.get('x-forwarded-for') ?? undefined;

  try {
    const instance = await prisma.approvalInstance.findUnique({
      where: { id: instanceId },
      select: { recordType: true },
    });
    if (!instance) {
      return NextResponse.json({ success: false, error: 'Approval instance not found' }, { status: 404 });
    }
    if (MODULE_SPECIFIC_RECORD_TYPES.has(instance.recordType)) {
      return NextResponse.json(
        {
          success: false,
          error: `${instance.recordType} requests must be actioned through their own module page — this generic endpoint would skip a required step (employee provisioning or branch sync) and leave the record permanently stuck.`,
        },
        { status: 409 }
      );
    }

    if (parsed.data.action === 'reopen') {
      await reopenWorkflow(instanceId, result.userId, parsed.data.remarks);
      return NextResponse.json({ success: true, message: 'Workflow reopened' });
    }

    const outcome = await processStageAction(
      {
        instanceId,
        actorUserId: result.userId,
        action: parsed.data.action as 'approve' | 'reject' | 'send_back' | 'request_info',
        remarks: parsed.data.remarks,
        ipAddress,
      },
      result
    );

    return NextResponse.json({ success: true, ...outcome });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    );
  }
}
