import { prisma } from '@/app/lib/prisma';
import { normalizeDenominationCounts, type DenominationCounts } from '@/app/lib/denomination-money';
import { parseDenominationEntryDateUtc } from '@/app/lib/branch-financial-day';

export type AutoDenominationResult = {
  workingDateYmd: string | null;
  counts: DenominationCounts;
  upi: number;
  totalAmount: number;
  centers: Array<{ centerName: string; centerCode: string; totalAmount: number; photoKey: string }>;
};

/**
 * Aggregates every APPROVED center's CollectionMeetingRecord for the branch's given
 * working date into a single branch-level denomination breakdown. This is the FDO
 * cash-count data, rolled up center-by-center — used to prefill the BM's EOD
 * denomination step (components/utilities/DenominationEntryPanel.tsx), which the
 * BM can then edit before saving/submitting.
 *
 * Only batches whose LoanTransaction has been BM-approved are included — an
 * unreconciled pending/rejected batch's cash isn't confirmed system-side yet.
 */
export async function computeAutoDenominationForBranch(
  branchId: string,
  workingDateYmd: string
): Promise<AutoDenominationResult> {
  const emptyCounts = normalizeDenominationCounts({});
  const collectionDate = parseDenominationEntryDateUtc(workingDateYmd);

  const records = await prisma.collectionMeetingRecord.findMany({
    where: { branchId, collectionDate },
    select: {
      collectionBatchId: true,
      photoKey: true,
      d500: true, d200: true, d100: true, d50: true,
      d20: true, d10: true, d5: true, d2: true, d1: true,
      upi: true, totalAmount: true,
      center: { select: { name: true, code: true } },
    },
  });

  if (records.length === 0) {
    return { workingDateYmd, counts: emptyCounts, upi: 0, totalAmount: 0, centers: [] };
  }

  const batchIds = records.map((r) => r.collectionBatchId);
  const approvedBatches = await prisma.loanTransaction.findMany({
    where: { collectionBatchId: { in: batchIds }, status: 'APPROVED' },
    select: { collectionBatchId: true },
    distinct: ['collectionBatchId'],
  });
  const approvedBatchIds = new Set(approvedBatches.map((b) => b.collectionBatchId));
  const approvedRecords = records.filter((r) => approvedBatchIds.has(r.collectionBatchId));

  const rawTotals: Record<keyof DenominationCounts, number> = {
    d500: 0, d200: 0, d100: 0, d50: 0, d20: 0, d10: 0, d5: 0, d2: 0, d1: 0,
  };
  let upi = 0;
  let totalAmount = 0;
  const centers: Array<{ centerName: string; centerCode: string; totalAmount: number; photoKey: string }> = [];

  for (const r of approvedRecords) {
    (Object.keys(rawTotals) as Array<keyof DenominationCounts>).forEach((key) => {
      rawTotals[key] += r[key];
    });
    upi += Number(r.upi);
    totalAmount += Number(r.totalAmount);
    centers.push({
      centerName: r.center?.name || '',
      centerCode: r.center?.code || '',
      totalAmount: Number(r.totalAmount),
      photoKey: r.photoKey,
    });
  }

  return {
    workingDateYmd,
    counts: normalizeDenominationCounts(rawTotals),
    upi: Number(upi.toFixed(2)),
    totalAmount: Number(totalAmount.toFixed(2)),
    centers,
  };
}
