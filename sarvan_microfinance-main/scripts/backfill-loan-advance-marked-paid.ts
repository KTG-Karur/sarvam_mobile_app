import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

/**
 * Backfills LoanSchedule.savingsPaid on installments that were mis-imported by the
 * "Ongoing Loan Backup" single-entry flow (app/api/ongoing-loan-backup/route.ts and its
 * PUT counterpart) before its fix: distributePayments() used to greedily smear an
 * aggregate "Loan Advance Paid" figure across the entire generated schedule, marking
 * future, never-collected installments' savings/loan-advance component as already paid —
 * even though principal/interest on those same rows was untouched (still 0).
 *
 * Detection: for every DISBURSED loan's non-PAID schedule rows, a row is flagged when
 * principalPaid = 0 AND interestPaid = 0 AND savingsPaid > 0 — the fingerprint of the
 * aggregate-distribution bug rather than a real collection (which moves principal/interest
 * together with savings). Uses "> 0", not "== savingsDue", since distributePayments' greedy
 * loop can leave the LAST row it touches only partially filled once the aggregate figure
 * runs out mid-installment.
 *
 * Fix: reset only LoanSchedule.savingsPaid to 0 on flagged rows. Does NOT touch
 * Client.loanAdvance or Loan.savingsPaid (both are correct — the wallet balance is real
 * money carried over from the member's prior loan cycle), any LoanTransaction/
 * LoanTransactionLine record, or LoanSchedule.status (already correctly PENDING/
 * PARTIALLY_PAID since status/totalDue/totalPaid never included the savings component).
 *
 * Run dry-run first (no --apply): prints every loan/installment that WOULD change.
 * Only pass --apply once you've reviewed that output and taken a DB backup.
 */
async function main() {
  const apply = process.argv.includes('--apply');

  const loans = await prisma.loan.findMany({
    where: { disbursementStatus: 'DISBURSED' },
    select: {
      id: true,
      loanNumber: true,
      client: { select: { clientId: true, firstName: true, lastName: true } },
      schedules: {
        where: { status: { not: 'PAID' } },
        select: {
          id: true,
          installmentNo: true,
          dueDate: true,
          savingsDue: true,
          savingsPaid: true,
          principalPaid: true,
          interestPaid: true,
          status: true,
        },
        orderBy: { installmentNo: 'asc' },
      },
    },
  });

  let loansAffected = 0;
  let rowsAffected = 0;
  const details: Array<{
    clientId: string;
    clientName: string;
    loanNumber: string;
    fixedInstallments: Array<{ installmentNo: number; dueDate: string; wasSavingsPaid: number }>;
  }> = [];

  for (const loan of loans) {
    const flagged = loan.schedules.filter(
      (s) => Number(s.principalPaid) === 0 && Number(s.interestPaid) === 0 && Number(s.savingsPaid) > 0
    );
    if (flagged.length === 0) continue;

    if (apply) {
      await prisma.$transaction(
        flagged.map((s) =>
          prisma.loanSchedule.update({
            where: { id: s.id },
            data: { savingsPaid: new Decimal(0) },
          })
        )
      );
    }

    loansAffected++;
    rowsAffected += flagged.length;
    details.push({
      clientId: loan.client.clientId,
      clientName: `${loan.client.firstName} ${loan.client.lastName}`.trim(),
      loanNumber: loan.loanNumber,
      fixedInstallments: flagged.map((s) => ({
        installmentNo: s.installmentNo,
        dueDate: s.dueDate.toISOString().slice(0, 10),
        wasSavingsPaid: Number(s.savingsPaid),
      })),
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        loansAffected,
        rowsAffected,
        details,
      },
      null,
      2
    )
  );

  if (!apply) {
    console.log(
      `\nDRY RUN ONLY — no rows were changed. Review the list above, take a DB backup, then re-run with --apply.`
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
