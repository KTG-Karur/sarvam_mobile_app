/**
 * Collection Approval workbench mode — buckets a transaction's installment lines
 * relative to the day it was collected on (not "now"), since a batch approved
 * days later must still classify by its original collection date.
 *
 * Shared by the Collection Approval workbench (app/api/collections/approve/route.ts,
 * which drives the Demand/Advance/Arrear tabs) and the "Allocate for EOD" tab
 * (app/api/collections/eod-allocation/route.ts) so a transaction is classified
 * identically everywhere it's shown as Demand/Advance/Arrear. setHours(0,0,0,0)
 * truncation is server-local, not Kolkata-aware — intentionally left as-is on the
 * move from approve/route.ts; don't "fix" this here without updating both call
 * sites in lockstep, or the two tabs will disagree again.
 */
export type WorkbenchMode = 'DEMAND' | 'ADVANCE' | 'ARREAR';

export function determineWorkbenchMode(
  schedules: Array<{ dueDate: string | null }>,
  referenceDate: Date
): WorkbenchMode {
  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);

  let hasFuture = false;
  let hasPast = false;
  let hasToday = false;

  for (const schedule of schedules) {
    if (!schedule.dueDate) continue;
    const dueDate = new Date(schedule.dueDate);
    dueDate.setHours(0, 0, 0, 0);
    if (dueDate > today) hasFuture = true;
    else if (dueDate < today) hasPast = true;
    else hasToday = true;
  }

  if (hasPast) return 'ARREAR';
  if (hasToday) return 'DEMAND';
  if (hasFuture) return 'ADVANCE';
  return 'DEMAND';
}
