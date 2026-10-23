import { describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { claimPendingTransaction, CollectionAlreadyProcessedError } from './claim-pending-transaction';

/** Minimal in-memory stand-in for tx.loanTransaction.updateMany's "only while PENDING" semantics. */
function fakeTx(initialStatus: string) {
  const row = { id: 'txn-1', status: initialStatus, approvedById: null as string | null };
  const tx = {
    loanTransaction: {
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Partial<typeof row> }) => {
        if (row.id !== where.id || row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  } as unknown as Prisma.TransactionClient;
  return { tx, row };
}

describe('claimPendingTransaction', () => {
  it('approves a PENDING collection', async () => {
    const { tx, row } = fakeTx('PENDING');
    await claimPendingTransaction(tx, { id: 'txn-1' }, 'user-1');
    expect(row.status).toBe('APPROVED');
    expect(row.approvedById).toBe('user-1');
  });

  it('second approval of the same collection throws instead of applying again', async () => {
    const { tx } = fakeTx('PENDING');
    await claimPendingTransaction(tx, { id: 'txn-1' }, 'user-1');
    await expect(claimPendingTransaction(tx, { id: 'txn-1', transactionId: 'TXN-1' }, 'user-2')).rejects.toBeInstanceOf(
      CollectionAlreadyProcessedError
    );
  });

  it('refuses a collection that was rejected meanwhile', async () => {
    const { tx, row } = fakeTx('REJECTED');
    await expect(claimPendingTransaction(tx, { id: 'txn-1' }, 'user-1')).rejects.toBeInstanceOf(
      CollectionAlreadyProcessedError
    );
    expect(row.status).toBe('REJECTED');
  });
});
