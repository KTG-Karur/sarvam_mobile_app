type TransactionLineLike = Readonly<{
  lineTotal: unknown;
  principalAmount?: unknown;
  interestAmount?: unknown;
  feesAmount?: unknown;
  penaltyAmount?: unknown;
  transaction?: Readonly<{
    transactionDate?: Date | null;
  }> | null;
}>;

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  if (value && typeof value === 'object' && 'toString' in value) {
    return Number((value as { toString: () => string }).toString());
  }
  return 0;
}

export type AggregatedCollection = Readonly<{
  principal: number;
  interest: number;
  fees: number;
  penalty: number;
  total: number;
  latestTransactionDate: Date | null;
}>;

export function aggregateCollectionFromTransactionLines(
  lines: readonly TransactionLineLike[]
): AggregatedCollection {
  let principal = 0;
  let interest = 0;
  let fees = 0;
  let penalty = 0;
  let total = 0;
  let latestTransactionDate: Date | null = null;

  for (const line of lines) {
    principal += toNumber(line.principalAmount);
    interest += toNumber(line.interestAmount);
    fees += toNumber(line.feesAmount);
    penalty += toNumber(line.penaltyAmount);
    total += toNumber(line.lineTotal);

    const txDate = line.transaction?.transactionDate ?? null;
    if (txDate && (!latestTransactionDate || txDate.getTime() > latestTransactionDate.getTime())) {
      latestTransactionDate = txDate;
    }
  }

  return { principal, interest, fees, penalty, total, latestTransactionDate };
}

