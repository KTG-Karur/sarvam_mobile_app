import type { Prisma } from '@prisma/client';

/** Thrown when a collection was already approved/rejected by a concurrent request. */
export class CollectionAlreadyProcessedError extends Error {
  constructor(public readonly transactionId: string) {
    super(`Collection ${transactionId} was already processed`);
    this.name = 'CollectionAlreadyProcessedError';
  }
}

/**
 * Atomically moves a PENDING collection to APPROVED inside the caller's transaction.
 *
 * The approve route reads its PENDING rows before opening the transaction, so two
 * near-simultaneous approvals (double-click, retry, two approvers) can both see the same
 * row as PENDING. A plain `update` lets both proceed and both add the amounts to the
 * schedule/loan balances — paid amounts end up higher than the ledger. The conditional
 * `updateMany` only matches while the row is still PENDING, so exactly one caller wins;
 * the loser throws and its whole transaction rolls back.
 */
export async function claimPendingTransaction(
  tx: Prisma.TransactionClient,
  transaction: { id: string; transactionId?: string | null },
  approvedById: string
): Promise<void> {
  const claimed = await tx.loanTransaction.updateMany({
    where: { id: transaction.id, status: 'PENDING' },
    data: { status: 'APPROVED', approvedById, approvedAt: new Date() },
  });
  if (claimed.count === 0) {
    throw new CollectionAlreadyProcessedError(transaction.transactionId ?? transaction.id);
  }
}
