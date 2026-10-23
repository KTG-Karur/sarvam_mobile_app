/**
 * Read-only drift check: do stored paid amounts agree with the collection ledger?
 *
 *  1. Active loans with a LoanSchedule whose principal/interest paid is above the approved,
 *     non-reversed LoanTransactionLine total (a collection applied twice).
 *  2. Loans whose Loan.principalPaid / interestPaid differ from the sum of their schedules.
 *  3. Active loans whose Loan.savingsPaid is above the approved SAVINGS_COLLECTION total.
 *
 * Exit code 1 when (1) or (2) finds anything, so it can gate a deploy / cron.
 * Fix (1)/(3) with scripts/fix-double-applied-collections.ts (dry-run first).
 *
 * Usage: npm run db:check:paid-vs-ledger
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const overLedger = await prisma.$queryRawUnsafe<
    Array<{ loanNumber: string; clientId: string; installmentNo: number; principalOver: string; interestOver: string }>
  >(`
    WITH led AS (
      SELECT tl."scheduleId" sid, SUM(tl."principalAmount") lp, SUM(tl."interestAmount") li
      FROM loan_transaction_lines tl JOIN loan_transactions t ON t.id = tl."transactionId"
      WHERE t."isReversed" = false AND t.status::text = 'APPROVED' GROUP BY 1)
    SELECT l."loanNumber", c."clientId", s."installmentNo",
           (s."principalPaid" - COALESCE(led.lp, 0)) AS "principalOver",
           (s."interestPaid" - COALESCE(led.li, 0)) AS "interestOver"
    FROM loan_schedules s
    JOIN loans l ON l.id = s."loanId"
    JOIN clients c ON c.id = l."clientId"
    LEFT JOIN led ON led.sid = s.id
    WHERE l."isActive" = true AND l."disbursementStatus"::text = 'DISBURSED'
      AND (s."principalPaid" > COALESCE(led.lp, 0) + 0.005 OR s."interestPaid" > COALESCE(led.li, 0) + 0.005)
    ORDER BY l."loanNumber", s."installmentNo"`);

  const loanVsSchedules = await prisma.$queryRawUnsafe<
    Array<{ loanNumber: string; loanPrincipal: string; schedPrincipal: string; loanInterest: string; schedInterest: string }>
  >(`
    SELECT l."loanNumber", l."principalPaid" AS "loanPrincipal", SUM(s."principalPaid") AS "schedPrincipal",
           l."interestPaid" AS "loanInterest", SUM(s."interestPaid") AS "schedInterest"
    FROM loans l JOIN loan_schedules s ON s."loanId" = l.id
    WHERE l."isActive" = true AND l."disbursementStatus"::text = 'DISBURSED'
    GROUP BY l.id, l."loanNumber", l."principalPaid", l."interestPaid"
    HAVING ABS(l."principalPaid" - SUM(s."principalPaid")) > 0.005 OR ABS(l."interestPaid" - SUM(s."interestPaid")) > 0.005
    ORDER BY l."loanNumber"`);

  const savingsOver = await prisma.$queryRawUnsafe<Array<{ n: number; excess: string }>>(`
    SELECT COUNT(*)::int n, COALESCE(SUM(l."savingsPaid" - COALESCE(sv.a, 0)), 0) excess
    FROM loans l
    LEFT JOIN (SELECT "loanId", SUM(amount) a FROM loan_transactions
               WHERE type::text = 'SAVINGS_COLLECTION' AND status::text = 'APPROVED' AND "isReversed" = false GROUP BY 1) sv
      ON sv."loanId" = l.id
    WHERE l."isActive" = true AND l."savingsPaid" > COALESCE(sv.a, 0) + 0.005`);

  console.log(`1. Schedules paid above ledger (active loans): ${overLedger.length}`);
  for (const r of overLedger.slice(0, 50)) {
    console.log(`   loan ${r.loanNumber} (${r.clientId}) #${r.installmentNo}: principal +${r.principalOver}, interest +${r.interestOver}`);
  }
  if (overLedger.length > 50) console.log(`   ... ${overLedger.length - 50} more`);
  console.log(`2. Loans whose paid totals differ from their schedules: ${loanVsSchedules.length}`);
  for (const r of loanVsSchedules.slice(0, 50)) {
    console.log(`   loan ${r.loanNumber}: principal ${r.loanPrincipal} vs ${r.schedPrincipal}, interest ${r.loanInterest} vs ${r.schedInterest}`);
  }
  console.log(
    `3. Active loans with savingsPaid above approved savings txns: ${savingsOver[0].n} (excess ${savingsOver[0].excess}) — ` +
      'includes legacy/backup loans, informational only'
  );

  if (overLedger.length > 0 || loanVsSchedules.length > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
