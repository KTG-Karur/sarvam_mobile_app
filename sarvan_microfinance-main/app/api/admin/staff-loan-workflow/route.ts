import { NextRequest } from 'next/server';
import { errorResponse, handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { WORKFLOW_PAGE, advanceWorkflowSchema, workflowSchema, type WorkflowKind } from '@/app/lib/staff-loans/configuration';
import { withStaffLoanMaster } from '@/app/lib/staff-loans/configuration-api';
import { getStaffLoanWorkflow, saveStaffLoanWorkflow } from '@/app/lib/staff-loans/configuration-service';

// One master page, two independent workflows: ?kind=ADVANCE selects the Staff Advance one (default: loan).
function kindOf(request: NextRequest): WorkflowKind | null {
    const value = request.nextUrl.searchParams.get('kind');
    if (value === null || value === 'LOAN') return 'LOAN';
    return value === 'ADVANCE' ? 'ADVANCE' : null;
}

export function OPTIONS() { return handleCorsPreflight(); }
export function GET(request: NextRequest) {
    return withStaffLoanMaster(WORKFLOW_PAGE, 'view', async (_req, _actorId, capabilities) => {
        const kind = kindOf(request);
        if (!kind) return errorResponse('Unknown workflow type', 400);
        return successResponse({ ...await getStaffLoanWorkflow(kind), capabilities });
    })(request);
}
export function PUT(request: NextRequest) {
    return withStaffLoanMaster(WORKFLOW_PAGE, 'view', async (req, actorId, capabilities) => {
        const kind = kindOf(request);
        if (!kind) return errorResponse('Unknown workflow type', 400);
        const body = await req.json();
        const input = kind === 'ADVANCE' ? advanceWorkflowSchema.parse(body) : workflowSchema.parse(body);
        if (!capabilities[input.expectedConfigId === null ? 'add' : 'edit']) return errorResponse('Insufficient permissions to save this workflow', 403);
        return successResponse(
            await saveStaffLoanWorkflow(input, actorId, kind),
            kind === 'ADVANCE' ? 'Staff advance workflow saved' : 'Staff loan workflow saved',
        );
    })(request);
}
