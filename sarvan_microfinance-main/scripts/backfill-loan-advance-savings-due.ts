import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

/**
 * Backfills LoanSchedule.savingsDue on installments that were mis-imported by the old
 * "Branch Wise Repayment" bulk-import path (app/lib/services/uploan-branch-repayment.service.ts)
 * before its fix: any installment that had a row in the source Excel got savingsDue
 * hardcoded to 0, even when that row only represented a partial payment. Those
 * installments are still open (status PENDING/PARTIALLY_PAID) but never carry the loan
 * product's advanceSavingsAmount forward, unlike genuine tail installments.
 *
 * Detection: for each DISBURSED loan, look at its non-PAID schedule rows ordered by
 * installmentNo. If a row has savingsDue = 0 while a LATER non-PAID row on the same loan
 * has savingsDue > 0, the earlier row is a gap — it should carry the same savingsDue as
 * the rest of the loan's still-open schedule.
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
        select: { id: true, installmentNo: true, dueDate: true, savingsDue: true, status: true },
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
    setSavingsDueTo: number;
    fixedInstallments: number[];
  }> = [];

  for (const loan of loans) {
    const rows = loan.schedules;
    if (rows.length === 0) continue;

    const maxSavings = Math.max(...rows.map((r) => Number(r.savingsDue)));
    if (maxSavings <= 0) continue; // this loan's product never charges a loan advance

    const gaps = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (Number(r.savingsDue) === 0) {
        const hasLaterPositive = rows.slice(i + 1).some((later) => Number(later.savingsDue) > 0);
        if (hasLaterPositive) gaps.push(r);
      }
    }
    if (gaps.length === 0) continue;

    if (apply) {
      await prisma.$transaction(
        gaps.map((g) =>
          prisma.loanSchedule.update({
            where: { id: g.id },
            data: { savingsDue: new Decimal(maxSavings) },
          }),
        ),
      );
    }

    loansAffected++;
    rowsAffected += gaps.length;
    details.push({
      clientId: loan.client.clientId,
      clientName: `${loan.client.firstName} ${loan.client.lastName}`.trim(),
      loanNumber: loan.loanNumber,
      setSavingsDueTo: maxSavings,
      fixedInstallments: gaps.map((g) => g.installmentNo),
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
      2,
    ),
  );

  if (!apply) {
    console.log(
      `\nDRY RUN ONLY — no rows were changed. Review the list above, take a DB backup, then re-run with --apply.`,
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
