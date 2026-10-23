// Shown under a still-pending request's status badge: which approval level it
// is waiting on, so requesters and other approvers can see why they have no
// Approve/Reject buttons. `approval` comes from the list APIs
// (describePendingApprovals in app/lib/approval/record-approval.ts).

export type RecordApproval = {
    stageName: string;
    approverRoleSlug: string;
    stageNumber: number;
    totalStages: number;
    /** Whether the signed-in viewer may approve/reject the current level. */
    canAct: boolean;
};

export function AwaitingApprovalStage({ approval }: { approval?: RecordApproval | null }) {
    if (!approval) return null;
    return (
        <div className="mt-1 text-[11px] leading-tight text-slate-500">
            Awaiting: {approval.stageName}
            {approval.totalStages > 1 && ` (level ${approval.stageNumber} of ${approval.totalStages})`}
        </div>
    );
}
