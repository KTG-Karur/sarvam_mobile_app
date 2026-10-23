import type { Prisma } from '@prisma/client';

export type LoanHistoryEntry = {
    loanId: string;
    action: string;
    performedById: string;
    remarks?: string | null;
    previousState?: string | null;
    newState?: string | null;
};

/**
 * Appends audit rows to LoanApprovalHistory (who did what, why, and the status
 * change). Pass the transaction client so the audit row commits or rolls back
 * together with the change it describes.
 */
export async function recordLoanHistory(
    tx: Prisma.TransactionClient,
    entries: LoanHistoryEntry[]
): Promise<void> {
    if (entries.length === 0) return;
    await tx.loanApprovalHistory.createMany({
        data: entries.map((e) => ({
            loanId: e.loanId,
            action: e.action,
            performedById: e.performedById,
            remarks: e.remarks ?? null,
            previousState: e.previousState ?? null,
            newState: e.newState ?? null,
        })),
    });
}
