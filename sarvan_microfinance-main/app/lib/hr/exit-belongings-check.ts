// ============================================================
// EXIT ↔ BELONGINGS CHECK
// app/lib/hr/exit-belongings-check.ts
//
// The Exit & Clearance checklist (EmployeeExitClearanceItem) and Belongings
// (EmployeeIssuedBelonging) are two separate systems — clearance is a
// department sign-off checklist, belongings is physical-asset custody. Exit
// finalization didn't check the second at all, so an employee could be fully
// cleared and deactivated while still shown as holding a laptop/ID card/etc.
// This ties them together: an exit can't finalize while any belonging issued
// to that employee is still marked ISSUED (not RETURNED/LOST/DAMAGED).
// ============================================================

import { prisma } from '@/app/lib/prisma';

export interface OutstandingBelonging {
  id: string;
  itemName: string;
  issuedDate: Date;
}

/** Belongings still marked ISSUED to this employee — must be returned (via
 * /dashboard/hr/belongings) before their exit can be finalized. */
export async function getOutstandingBelongings(employeeId: string): Promise<OutstandingBelonging[]> {
  const rows = await prisma.employeeIssuedBelonging.findMany({
    where: { employeeId, status: 'ISSUED' },
    select: { id: true, issuedDate: true, belongingItem: { select: { itemName: true } } },
    orderBy: { issuedDate: 'asc' },
  });
  return rows.map((r) => ({ id: r.id, itemName: r.belongingItem.itemName, issuedDate: r.issuedDate }));
}

export interface ClosedBelonging {
  id: string;
  itemName: string;
  status: 'RETURNED' | 'LOST' | 'DAMAGED';
  returnedDate: Date | null;
  condition: string | null;
  remarks: string | null;
  recoveryAmount: string | null;
  returnedTo: { firstName: string; lastName: string } | null;
  proofs: { id: string; fileKey: string; fileName: string; mimeType: string }[];
}

/** Belongings this employee has already handed back (or that were closed as
 * lost/damaged), with the return photos — shown on the exit checklist so the
 * approver can see the evidence before the final approval. */
export async function getClosedBelongings(employeeId: string): Promise<ClosedBelonging[]> {
  const rows = await prisma.employeeIssuedBelonging.findMany({
    where: { employeeId, status: { not: 'ISSUED' } },
    select: {
      id: true, status: true, returnedDate: true, condition: true, remarks: true, recoveryAmount: true,
      belongingItem: { select: { itemName: true } },
      returnedTo: { select: { firstName: true, lastName: true } },
      returnProofs: { select: { id: true, fileKey: true, fileName: true, mimeType: true }, orderBy: { createdAt: 'asc' } },
    },
    orderBy: { returnedDate: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    itemName: r.belongingItem.itemName,
    status: r.status as ClosedBelonging['status'],
    returnedDate: r.returnedDate,
    condition: r.condition,
    remarks: r.remarks,
    recoveryAmount: r.recoveryAmount?.toString() ?? null,
    returnedTo: r.returnedTo,
    proofs: r.returnProofs,
  }));
}

/** Batched count for list views — employeeId -> number of ISSUED (unreturned) belongings. */
export async function getOutstandingBelongingsCounts(employeeIds: string[]): Promise<Map<string, number>> {
  if (employeeIds.length === 0) return new Map();
  const grouped = await prisma.employeeIssuedBelonging.groupBy({
    by: ['employeeId'],
    where: { employeeId: { in: employeeIds }, status: 'ISSUED' },
    _count: { _all: true },
  });
  return new Map(grouped.map((g) => [g.employeeId, g._count._all]));
}

/** The exact message every exit-finalizing route shows when belongings block completion. */
export function outstandingBelongingsMessage(items: OutstandingBelonging[]): string {
  return `${items.length} belonging(s) not yet returned: ${items.map((i) => i.itemName).join(', ')}. Record their return (with proof) first.`;
}
