/**
 * Demo data seeder: 2 Theni clients whose loans have installments due BOTH today
 * and tomorrow, so the FDO can run Demand Collection today, then again tomorrow
 * once the branch's working day (EOD) advances — plus arrear installments so the
 * Arrear Collection screen also has data for these clients.
 *
 * Attached to the real, already-in-use Theni branch (id: cmq6bkmxr0061s6awjz9v2mg1).
 * This script does NOT touch Theni's Branch or BranchLock rows — it only reads the
 * branch's existing `currentWorkingDate` (read-only) and anchors every seeded due
 * date to it, same as the sibling seeder. If Theni has no BranchLock row, it falls
 * back to the real calendar date in IST.
 *
 * Reuses shared demo masters created by demand-collection-test-data-theni.seeder.ts
 * if they already exist (FDO `DEMO-FDO-THENI`, center `DEMO-THENI`, loan products
 * `DEMO-WEEKLY-10K` / `DEMO-DAILY-5K`) — creates them only if missing, and never
 * overwrites their existing fields EXCEPT `meetingDay`, which is kept in sync with
 * the branch's current working-date weekday on every run (the Demand Collection
 * center picker only lists centers whose meetingDay matches today's weekday, so a
 * stale value from an earlier anchor date would silently hide this center).
 *
 * Net-new and isolated from everything else:
 *   - 2 clients (`DEMOTH-05`, `DEMOTH-06`)
 *   - 3 loans, mixing daily + weekly frequency:
 *     - Loan E (client 05, DAILY): 3 missed installments (arrears) + 1 due today
 *       + 1 due tomorrow, in the same schedule (daily cadence naturally lines up).
 *     - Loan F (client 06, WEEKLY): 2 missed installments (arrears) + 1 due today.
 *     - Loan G (client 06, WEEKLY): 2 missed installments (arrears) + 1 due tomorrow.
 *
 * Note: the Demand Collection API rejects "future" collection dates (see
 * app/api/collections/demand/route.ts) — tomorrow's installments won't be
 * collectible until Theni's EOD actually advances currentWorkingDate to that day.
 * That's expected real behavior, not a seeding gap.
 *
 * Safe to re-run: only rows carrying the `DEMO-LN-THENI-TT-` loan-number prefix
 * are deleted and recreated each run (never touches other seeders' loans, or
 * Theni's real centers/clients/loans).
 *
 * Run: npx tsx prisma/seeders/demand-collection-test-data-theni-today-tomorrow.seeder.ts
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.DATABASE_URL +
        (process.env.DATABASE_URL?.includes('?') ? '&' : '?') +
        'connection_limit=1&pool_timeout=0',
    },
  },
});

const KOLKATA_TZ = 'Asia/Kolkata';
const THENI_BRANCH_ID = 'cmq6bkmxr0061s6awjz9v2mg1';
const LOAN_NUMBER_PREFIX = 'DEMO-LN-THENI-TT-';

function kolkataDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+05:30`);
}

function toYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KOLKATA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function addDaysYmd(ymd: string, days: number): string {
  return toYmd(new Date(kolkataDate(ymd).getTime() + days * 86_400_000));
}

function weekdayName(ymd: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: KOLKATA_TZ }).format(kolkataDate(ymd));
}

type InstallmentPlan = {
  installmentNo: number;
  dueYmd: string;
};

async function main() {
  const branch = await prisma.branch.findUnique({ where: { id: THENI_BRANCH_ID } });
  if (!branch) {
    throw new Error(`Branch ${THENI_BRANCH_ID} not found — refusing to create a new branch under this script.`);
  }
  const branchId = branch.id;

  // Read-only: never create/modify BranchLock for a real branch.
  const lock = await prisma.branchLock.findUnique({ where: { branchId: branch.id } });
  const anchorYmd = lock ? toYmd(lock.currentWorkingDate) : toYmd(new Date());
  const tomorrowYmd = addDaysYmd(anchorYmd, 1);
  if (!lock) {
    console.log(`⚠️  No BranchLock found for ${branch.name} — falling back to real calendar date (${anchorYmd}).`);
  } else {
    console.log(`ℹ️  Using ${branch.name}'s existing working date as "today": ${anchorYmd} (BranchLock left untouched).`);
  }

  const bm = await prisma.user.findFirst({
    where: { branchId: branch.id, role: 'BRANCH_MANAGER', isActive: true },
  });

  // ── Reuse shared demo FDO if present, else create it (does not overwrite existing) ──
  let fdo = await prisma.user.findUnique({ where: { employeeId: 'DEMO-FDO-THENI' } });
  if (!fdo) {
    const demoPassword = 'Demo@12345';
    const hashedPassword = await bcrypt.hash(demoPassword, 10);
    fdo = await prisma.user.create({
      data: {
        employeeId: 'DEMO-FDO-THENI',
        firstName: 'Demo',
        lastName: 'FDO (Theni)',
        role: 'FDO',
        branchId: branch.id,
        password: hashedPassword,
        isActive: true,
      },
    });
    console.log(`✅ Demo FDO created: ${fdo.employeeId} (password: ${demoPassword})`);
  } else {
    console.log(`✅ Reusing existing demo FDO: ${fdo.employeeId}`);
  }

  // ── Reuse shared demo loan products if present, else create them ──
  const productType = await prisma.loanProductType.upsert({
    where: { typeId: 'DEMO-TYPE' },
    update: {},
    create: { typeId: 'DEMO-TYPE', name: 'Demo Loan Products', isActive: true },
  });

  const weeklyProduct = await prisma.loanProduct.upsert({
    where: { productId: 'DEMO-WEEKLY-10K' },
    update: {},
    create: {
      productId: 'DEMO-WEEKLY-10K',
      productName: 'Demo Weekly 10,000',
      loanAmount: 10000,
      interestRate: 10,
      frequency: 'weekly',
      interestAmount: 1000,
      numberOfDues: 10,
      status: 'enabled',
      isActive: true,
      loanProductTypeId: productType.id,
    },
  });

  const dailyProduct = await prisma.loanProduct.upsert({
    where: { productId: 'DEMO-DAILY-5K' },
    update: {},
    create: {
      productId: 'DEMO-DAILY-5K',
      productName: 'Demo Daily 5,000',
      loanAmount: 5000,
      interestRate: 12,
      frequency: 'daily',
      interestAmount: 500,
      numberOfDues: 50,
      status: 'enabled',
      isActive: true,
      loanProductTypeId: productType.id,
    },
  });
  console.log('✅ Loan products ready: weekly (10,000/10 dues), daily (5,000/50 dues).');

  // ── Reuse shared demo center if present, else create it ──
  let center = await prisma.center.findUnique({
    where: { branchId_code: { branchId: branch.id, code: 'DEMO-THENI' } },
  });
  if (!center) {
    center = await prisma.center.create({
      data: {
        name: 'Demo Center (Theni)',
        code: 'DEMO-THENI',
        branchId: branch.id,
        createdById: bm?.id ?? fdo.id,
        fdoId: fdo.id,
        status: 'APPROVED',
        isActive: true,
        meetingDay: weekdayName(anchorYmd),
        meetingPlace: 'Demo Meeting Hall',
        meetingTime: '10:00 AM',
      },
    });
    console.log(`✅ Center "${center.name}" created.`);
  } else {
    // Keep meetingDay in sync with the branch's current working date each run —
    // the Demand Collection center picker only lists centers whose meetingDay
    // matches today's weekday, so a stale value (from an earlier anchor date)
    // would silently hide this center from the FDO.
    const todaysWeekday = weekdayName(anchorYmd);
    if (center.meetingDay !== todaysWeekday) {
      center = await prisma.center.update({
        where: { id: center.id },
        data: { meetingDay: todaysWeekday },
      });
      console.log(`✅ Reusing existing center: ${center.name} (meetingDay updated to ${todaysWeekday})`);
    } else {
      console.log(`✅ Reusing existing center: ${center.name}`);
    }
  }

  // ── Clients ──
  const clientDefs = [
    { clientId: 'DEMOTH-05', firstName: 'Demo Client', lastName: 'Five (Theni)' },
    { clientId: 'DEMOTH-06', firstName: 'Demo Client', lastName: 'Six (Theni)' },
  ];

  const clients = [];
  for (const def of clientDefs) {
    // upsert needs a unique selector — Client.clientId isn't DB-unique (uploan-imported
    // legacy IDs can intentionally collide, see schema.prisma) — so this seeder's own
    // fixed demo IDs are found/updated manually instead.
    const existing = await prisma.client.findFirst({ where: { clientId: def.clientId } });
    const client = existing
      ? await prisma.client.update({
          where: { id: existing.id },
          data: { centerId: center.id, isActive: true },
        })
      : await prisma.client.create({
          data: {
            clientId: def.clientId,
            firstName: def.firstName,
            lastName: def.lastName,
            centerId: center.id,
            enrolledById: fdo.id,
            verificationStatus: 'VERIFIED',
            approvalStatus: 'APPROVED',
            isActive: true,
          },
        });
    clients.push(client);
  }
  console.log(`✅ ${clients.length} clients ready under ${center.name}.`);

  // ── Reset previously seeded loans from THIS script only ──
  const existingLoans = await prisma.loan.findMany({
    where: { loanNumber: { startsWith: LOAN_NUMBER_PREFIX } },
    select: { id: true },
  });
  if (existingLoans.length) {
    const loanIds = existingLoans.map((l) => l.id);
    await prisma.loanTransaction.deleteMany({ where: { loanId: { in: loanIds } } });
    await prisma.loan.deleteMany({ where: { id: { in: loanIds } } });
    console.log(`🧹 Cleared ${existingLoans.length} previously seeded today/tomorrow demo loan(s) for a fresh rebuild.`);
  }

  async function createLoan(params: {
    letter: string;
    clientId: string;
    product: typeof weeklyProduct;
    frequency: 'WEEKLY' | 'DAILY';
    tenureMonths: number;
    plan: InstallmentPlan[];
    scenarioLabel: string;
  }) {
    const { letter, clientId, product, frequency, tenureMonths, plan, scenarioLabel } = params;
    const principalPerInstallment = Number(product.loanAmount) / product.numberOfDues;
    const interestPerInstallment = Number(product.interestAmount) / product.numberOfDues;
    const totalDue = principalPerInstallment + interestPerInstallment;

    const firstDue = plan[0].dueYmd;

    const loan = await prisma.loan.create({
      data: {
        loanNumber: `${LOAN_NUMBER_PREFIX}${letter}`,
        clientId,
        centerId: center!.id,
        branchId,
        applicationStatus: 'VERIFIED',
        disbursementStatus: 'DISBURSED',
        amount: product.loanAmount,
        interestRate: product.interestRate,
        tenureMonths,
        createdById: fdo!.id,
        verifiedById: bm?.id,
        verifiedAt: bm ? kolkataDate(addDaysYmd(firstDue, -1)) : undefined,
        disbursedByBMId: bm?.id,
        disbursedByBMAt: bm ? kolkataDate(addDaysYmd(firstDue, -1)) : undefined,
        firstDueDate: kolkataDate(firstDue),
        isActive: true,
        frequency,
        loanProductId: product.id,
      },
    });

    for (const inst of plan) {
      const dueDate = kolkataDate(inst.dueYmd);
      await prisma.loanSchedule.create({
        data: {
          loanId: loan.id,
          installmentNo: inst.installmentNo,
          dueDate,
          principalDue: principalPerInstallment,
          interestDue: interestPerInstallment,
          totalDue,
          principalPaid: 0,
          interestPaid: 0,
          totalPaid: 0,
          status: 'PENDING',
        },
      });
    }

    console.log(`✅ Loan ${loan.loanNumber} (${clientId}) — ${scenarioLabel}`);
  }

  // Loan E: daily loan for client 05 — 3 missed (arrears) + due TODAY + due TOMORROW,
  // all in one naturally-consecutive daily schedule. Installment #4 lands on anchorYmd.
  await createLoan({
    letter: 'E',
    clientId: clients[0].id,
    product: dailyProduct,
    frequency: 'DAILY',
    tenureMonths: 2,
    scenarioLabel: `installments #1-3 missed (arrears), #4 due TODAY (${anchorYmd}), #5 due TOMORROW (${tomorrowYmd})`,
    plan: Array.from({ length: 50 }, (_, i) => {
      const n = i + 1;
      const dueYmd = addDaysYmd(anchorYmd, n - 4);
      return { installmentNo: n, dueYmd };
    }),
  });

  // Loan F: weekly loan for client 06 — 2 missed (arrears) + due TODAY.
  await createLoan({
    letter: 'F',
    clientId: clients[1].id,
    product: weeklyProduct,
    frequency: 'WEEKLY',
    tenureMonths: 3,
    scenarioLabel: `installments #1-2 missed (arrears), #3 due TODAY (${anchorYmd})`,
    plan: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
      installmentNo: n,
      dueYmd: addDaysYmd(anchorYmd, (n - 3) * 7),
    })),
  });

  // Loan G: second weekly loan for client 06 — 2 missed (arrears) + due TOMORROW.
  await createLoan({
    letter: 'G',
    clientId: clients[1].id,
    product: weeklyProduct,
    frequency: 'WEEKLY',
    tenureMonths: 3,
    scenarioLabel: `installments #1-2 missed (arrears), #3 due TOMORROW (${tomorrowYmd})`,
    plan: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
      installmentNo: n,
      dueYmd: addDaysYmd(tomorrowYmd, (n - 3) * 7),
    })),
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Demo login (Demand Collection / Arrear Collection):');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🆔 FDO Employee ID: ${fdo.employeeId}`);
  console.log(`🏢 Branch:          ${branch.name} (${branch.code}) — id ${branch.id}`);
  console.log(`🏬 Center:          ${center.name}`);
  console.log(`📅 Today:           ${anchorYmd} (Theni's own BranchLock working date, untouched)`);
  console.log(`📅 Tomorrow:        ${tomorrowYmd}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DEMOTH-05 / Loan E (daily)  → Arrear + Demand today; installment for tomorrow queued');
  console.log('DEMOTH-06 / Loan F (weekly) → Arrear + Demand today');
  console.log('DEMOTH-06 / Loan G (weekly) → Arrear today; Demand appears tomorrow');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Note: "tomorrow" installments only become collectible once Theni\'s EOD');
  console.log('advances currentWorkingDate to that date — the Demand Collection API');
  console.log('rejects future collection dates by design.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding Theni today/tomorrow demand-collection demo data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
