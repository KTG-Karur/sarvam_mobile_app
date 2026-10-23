/**
 * Data repair: collections that were approved twice.
 *
 * Before the atomic claim in app/lib/collections/claim-pending-transaction.ts, two
 * near-simultaneous approvals of the same collection could both add its amounts to the
 * schedule and loan balances. The ledger (approved, non-reversed LoanTransactionLine rows)
 * still has the amount once, so LoanSchedule.principalPaid/interestPaid (and Loan.principalPaid/
 * interestPaid/savingsPaid) ended up higher than what was really collected — every screen then
 * shows a smaller outstanding (e.g. loan 50109: O/S principal 6,500 instead of 7,200).
 *
 * Scope: ACTIVE, DISBURSED loans only. Closed / migrated loans legitimately carry paid amounts
 * with no ledger lines (closed-member import, foreclosure finalisation) and are never touched.
 * Only ever LOWERS a schedule component that is above its ledger amount.
 *
 * For each affected loan (one DB transaction per loan):
 *   - schedules: paid fields -> ledger amounts, totalPaid/status/paidAt recomputed
 *   - Loan.principalPaid / interestPaid / penaltiesPaid: decremented by what was removed
 *   - Loan.savingsPaid: lowered to the approved SAVINGS_COLLECTION total when it is above it
 *   - Client.loanAdvance: only with --fix-loan-advance (that wallet is also moved by other flows)
 *
 * Usage:
 *   npx tsx scripts/fix-double-applied-collections.ts                  # dry run, prints a report
 *   npx tsx scripts/fix-double-applied-collections.ts --loan=50109     # restrict to one loan number
 *   npx tsx scripts/fix-double-applied-collections.ts --apply          # write the repair
 *   npx tsx scripts/fix-double-applied-collections.ts --apply --fix-loan-advance
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { computeScheduleRepair, round2, type ScheduleRepair } from '@/app/lib/collections/paid-ledger-repair';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const FIX_LOAN_ADVANCE = process.argv.includes('--fix-loan-advance');
const LOAN_FILTER = process.argv.find((a) => a.startsWith('--loan='))?.split('=')[1];

type Candidate = { loanId: string };

async function findCandidateLoanIds(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Candidate[]>(Prisma.sql`
    WITH led AS (
      SELECT tl."scheduleId" AS sid,
             SUM(tl."principalAmount") AS lp, SUM(tl."interestAmount") AS li,
             SUM(tl."feesAmount") AS lf, SUM(tl."penaltyAmount") AS lpen
      FROM loan_transaction_lines tl
      JOIN loan_transactions t ON t.id = tl."transactionId"
      WHERE t."isReversed" = false AND t.status::text = 'APPROVED'
      GROUP BY tl."scheduleId"
    )
    SELECT DISTINCT l.id AS "loanId"
    FROM loan_schedules s
    JOIN loans l ON l.id = s."loanId"
    LEFT JOIN led ON led.sid = s.id
    WHERE l."isActive" = true
      AND l."disbursementStatus"::text = 'DISBURSED'
      ${LOAN_FILTER ? Prisma.sql`AND l."loanNumber" = ${LOAN_FILTER}` : Prisma.empty}
      AND (s."principalPaid" > COALESCE(led.lp, 0) + 0.005
        OR s."interestPaid" > COALESCE(led.li, 0) + 0.005
        OR s."feesPaid" > COALESCE(led.lf, 0) + 0.005
        OR s."penaltiesPaid" > COALESCE(led.lpen, 0) + 0.005)
  `);
  return rows.map((r) => r.loanId);
}

async function repairLoan(loanId: string) {
  return prisma.$transaction(
    async (tx) => {
      const loan = await tx.loan.findUniqueOrThrow({
        where: { id: loanId },
        select: {
          id: true, loanNumber: true, clientId: true,
          principalPaid: true, interestPaid: true, penaltiesPaid: true, savingsPaid: true,
          client: { select: { clientId: true, loanAdvance: true } },
          schedules: { orderBy: { installmentNo: 'asc' } },
        },
      });

      const lines = await tx.loanTransactionLine.groupBy({
        by: ['scheduleId'],
        where: { scheduleId: { in: loan.schedules.map((s) => s.id) }, transaction: { isReversed: false, status: 'APPROVED' } },
        _sum: { principalAmount: true, interestAmount: true, feesAmount: true, penaltyAmount: true },
      });
      const ledgerBySchedule = new Map(lines.map((l) => [l.scheduleId, l._sum]));

      // A loan with no ledger at all can't be repaired from it — leave to manual review.
      if (ledgerBySchedule.size === 0) {
        return { loan, skipped: 'no ledger lines', repairs: [] as Array<{ installmentNo: number; id: string; repair: ScheduleRepair }>, savingsExcess: 0 };
      }

      const repairs: Array<{ installmentNo: number; id: string; repair: ScheduleRepair }> = [];
      for (const s of loan.schedules) {
        const l = ledgerBySchedule.get(s.id);
        const repair = computeScheduleRepair(
          {
            principalDue: Number(s.principalDue), interestDue: Number(s.interestDue),
            feesDue: Number(s.feesDue), penaltiesDue: Number(s.penaltiesDue),
            principalPaid: Number(s.principalPaid), interestPaid: Number(s.interestPaid),
            feesPaid: Number(s.feesPaid), penaltiesPaid: Number(s.penaltiesPaid),
            paidAt: s.paidAt,
          },
          {
            principal: Number(l?.principalAmount ?? 0), interest: Number(l?.interestAmount ?? 0),
            fees: Number(l?.feesAmount ?? 0), penalty: Number(l?.penaltyAmount ?? 0),
          }
        );
        if (repair) repairs.push({ installmentNo: s.installmentNo, id: s.id, repair });
      }

      const savingsAgg = await tx.loanTransaction.aggregate({
        where: { loanId, type: 'SAVINGS_COLLECTION', status: 'APPROVED', isReversed: false },
        _sum: { amount: true },
      });
      const savingsExcess = Math.max(0, round2(Number(loan.savingsPaid) - Number(savingsAgg._sum.amount ?? 0)));

      if (APPLY) {
        const removed = { principal: 0, interest: 0, penalty: 0 };
        for (const { id, repair } of repairs) {
          await tx.loanSchedule.update({
            where: { id },
            data: {
              principalPaid: repair.principalPaid,
              interestPaid: repair.interestPaid,
              feesPaid: repair.feesPaid,
              penaltiesPaid: repair.penaltiesPaid,
              totalPaid: repair.totalPaid,
              status: repair.status,
              paidAt: repair.paidAt,
            },
          });
          removed.principal += repair.removed.principal;
          removed.interest += repair.removed.interest;
          removed.penalty += repair.removed.penalty;
        }
        await tx.loan.update({
          where: { id: loanId },
          data: {
            principalPaid: { decrement: round2(removed.principal) },
            interestPaid: { decrement: round2(removed.interest) },
            penaltiesPaid: { decrement: round2(removed.penalty) },
            ...(savingsExcess > 0 ? { savingsPaid: { decrement: savingsExcess } } : {}),
          },
        });
        if (FIX_LOAN_ADVANCE && savingsExcess > 0) {
          const newAdvance = Math.max(0, round2(Number(loan.client.loanAdvance) - savingsExcess));
          await tx.client.update({ where: { id: loan.clientId }, data: { loanAdvance: newAdvance } });
        }
      }
      return { loan, skipped: null as string | null, repairs, savingsExcess };
    },
    { timeout: 60_000, maxWait: 15_000 }
  );
}

async function main() {
  console.log(APPLY ? '*** APPLY MODE — writing changes ***' : '--- DRY RUN (no writes; pass --apply to write) ---');
  const loanIds = await findCandidateLoanIds();
  console.log(`Active loans with a schedule paid above its ledger: ${loanIds.length}\n`);

  const totals = { loans: 0, schedules: 0, principal: 0, interest: 0, savings: 0, skipped: 0 };
  for (const loanId of loanIds) {
    const r = await repairLoan(loanId);
    const { loan } = r;
    if (r.skipped) {
      totals.skipped++;
      console.log(`SKIP  ${loan.loanNumber} (${loan.client.clientId}): ${r.skipped}`);
      continue;
    }
    if (r.repairs.length === 0 && r.savingsExcess === 0) continue;
    totals.loans++;
    totals.schedules += r.repairs.length;
    totals.savings += r.savingsExcess;
    const rp = r.repairs.reduce((s, x) => s + x.repair.removed.principal, 0);
    const ri = r.repairs.reduce((s, x) => s + x.repair.removed.interest, 0);
    totals.principal += rp;
    totals.interest += ri;
    console.log(
      `${loan.loanNumber} (${loan.client.clientId}): loan.principalPaid ${Number(loan.principalPaid)} -> ${round2(Number(loan.principalPaid) - rp)}, ` +
        `interestPaid ${Number(loan.interestPaid)} -> ${round2(Number(loan.interestPaid) - ri)}, ` +
        `savingsPaid -${r.savingsExcess} | installments: ` +
        r.repairs.map((x) => `#${x.installmentNo} -${x.repair.removed.principal}p/-${x.repair.removed.interest}i -> ${x.repair.status}`).join(', ')
    );
  }

  console.log(
    `\nTotal: ${totals.loans} loans, ${totals.schedules} installments, principal -${round2(totals.principal)}, ` +
      `interest -${round2(totals.interest)}, savingsPaid -${round2(totals.savings)}, skipped ${totals.skipped}`
  );
  if (!FIX_LOAN_ADVANCE && totals.savings > 0) {
    console.log('Client.loanAdvance was NOT changed (pass --fix-loan-advance with --apply to lower it by the same savings excess).');
  }
  if (!APPLY) console.log('Dry run only — nothing was written.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
