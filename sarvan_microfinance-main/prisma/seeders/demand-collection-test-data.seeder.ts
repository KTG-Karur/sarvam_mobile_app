/**
 * Demo data seeder for the FDO "Today Demand Collection" / "Arrear Collection" screens
 * (app/api/collections/demand, app/api/collections/arrear).
 *
 * Creates one demo branch (with a BranchLock pinned to "today" in IST), one BM, one FDO,
 * one center assigned to that FDO with meetingDay == today's weekday, 4 clients, and 4
 * loans covering the scenarios that exercise both screens:
 *
 *   Loan A (weekly)  — clean history, one installment due exactly today   -> Demand only
 *   Loan B (weekly)  — one missed installment + one due today             -> Arrear + Demand
 *   Loan C (weekly)  — three missed installments, none due today          -> Arrear only
 *   Loan D (daily)   — two missed days + one due today                    -> Arrear + Demand (daily)
 *
 * Safe to re-run: branch/users/product/center are upserted; loans+schedules+transactions
 * carrying the `DEMO-LN-` prefix are deleted and recreated each run so due dates always
 * line up with "today" again.
 *
 * Run: npx tsx prisma/seeders/demand-collection-test-data.seeder.ts
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
const LOAN_NUMBER_PREFIX = 'DEMO-LN-';
const TXN_ID_PREFIX = 'DEMO-TXN-';

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
  paid: boolean;
};

async function main() {
  const todayYmd = toYmd(new Date());
  console.log(`\n🌱 Seeding demand/arrear collection demo data (today = ${todayYmd} IST, ${weekdayName(todayYmd)})...\n`);

  // ── Branch + BranchLock ──
  const branch = await prisma.branch.upsert({
    where: { code: 'DEMOBR' },
    update: { isActive: true },
    create: {
      name: 'Demo Branch (FDO Demand Test)',
      code: 'DEMOBR',
      address: 'Demo Branch Address',
      isActive: true,
    },
  });

  await prisma.branchLock.upsert({
    where: { branchId: branch.id },
    update: {
      currentWorkingDate: kolkataDate(todayYmd),
      lockTime: new Date(),
      timezone: KOLKATA_TZ,
    },
    create: {
      branchId: branch.id,
      currentWorkingDate: kolkataDate(todayYmd),
      lockTime: new Date(),
      timezone: KOLKATA_TZ,
      defaultOpenMinutes: 540,
      defaultCloseMinutes: 1080,
    },
  });
  console.log(`✅ Branch "${branch.name}" (${branch.code}) ready, working date pinned to ${todayYmd}.`);

  // ── Users: BM + FDO ──
  const demoPassword = 'Demo@12345';
  const hashedPassword = await bcrypt.hash(demoPassword, 10);

  const bm = await prisma.user.upsert({
    where: { employeeId: 'DEMO-BM-01' },
    update: { branchId: branch.id, isActive: true },
    create: {
      employeeId: 'DEMO-BM-01',
      firstName: 'Demo',
      lastName: 'BranchManager',
      role: 'BRANCH_MANAGER',
      branchId: branch.id,
      password: hashedPassword,
      isActive: true,
    },
  });

  const fdo = await prisma.user.upsert({
    where: { employeeId: 'DEMO-FDO-01' },
    update: { branchId: branch.id, isActive: true },
    create: {
      employeeId: 'DEMO-FDO-01',
      firstName: 'Demo',
      lastName: 'FDO',
      role: 'FDO',
      branchId: branch.id,
      password: hashedPassword,
      isActive: true,
    },
  });
  console.log(`✅ Users ready: BM(${bm.employeeId}) / FDO(${fdo.employeeId}), password for both: ${demoPassword}`);

  // ── Loan product type + products ──
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

  // ── Center (meetingDay must match today's weekday so the FDO screen shows it) ──
  const center = await prisma.center.upsert({
    where: { branchId_code: { branchId: branch.id, code: '1' } },
    update: {
      fdoId: fdo.id,
      status: 'APPROVED',
      isActive: true,
      meetingDay: weekdayName(todayYmd),
    },
    create: {
      name: 'Demo Center 1',
      code: '1',
      branchId: branch.id,
      createdById: bm.id,
      fdoId: fdo.id,
      status: 'APPROVED',
      isActive: true,
      meetingDay: weekdayName(todayYmd),
      meetingPlace: 'Demo Meeting Hall',
      meetingTime: '10:00 AM',
    },
  });
  console.log(`✅ Center "${center.name}" ready, meetingDay=${center.meetingDay}, assigned FDO=${fdo.employeeId}.`);

  // ── Clients ──
  const clientDefs = [
    { clientId: 'DEMOC-01', firstName: 'Demo Client', lastName: 'One' },
    { clientId: 'DEMOC-02', firstName: 'Demo Client', lastName: 'Two' },
    { clientId: 'DEMOC-03', firstName: 'Demo Client', lastName: 'Three' },
    { clientId: 'DEMOC-04', firstName: 'Demo Client', lastName: 'Four' },
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

  // ── Reset previously seeded loans (schedules/transactions cascade or are deleted first) ──
  const existingLoans = await prisma.loan.findMany({
    where: { loanNumber: { startsWith: LOAN_NUMBER_PREFIX } },
    select: { id: true },
  });
  if (existingLoans.length) {
    const loanIds = existingLoans.map((l) => l.id);
    await prisma.loanTransaction.deleteMany({ where: { loanId: { in: loanIds } } });
    await prisma.loan.deleteMany({ where: { id: { in: loanIds } } });
    console.log(`🧹 Cleared ${existingLoans.length} previously seeded demo loan(s) for a fresh rebuild.`);
  }

  // ── Helper: create one loan + its schedule (+ transactions for paid installments) ──
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
        centerId: center.id,
        branchId: branch.id,
        applicationStatus: 'VERIFIED',
        disbursementStatus: 'DISBURSED',
        amount: product.loanAmount,
        interestRate: product.interestRate,
        tenureMonths,
        createdById: fdo.id,
        verifiedById: bm.id,
        verifiedAt: kolkataDate(addDaysYmd(firstDue, -1)),
        disbursedByBMId: bm.id,
        disbursedByBMAt: kolkataDate(addDaysYmd(firstDue, -1)),
        firstDueDate: kolkataDate(firstDue),
        isActive: true,
        frequency,
        loanProductId: product.id,
      },
    });

    for (const inst of plan) {
      const dueDate = kolkataDate(inst.dueYmd);
      const schedule = await prisma.loanSchedule.create({
        data: {
          loanId: loan.id,
          installmentNo: inst.installmentNo,
          dueDate,
          principalDue: principalPerInstallment,
          interestDue: interestPerInstallment,
          totalDue,
          principalPaid: inst.paid ? principalPerInstallment : 0,
          interestPaid: inst.paid ? interestPerInstallment : 0,
          totalPaid: inst.paid ? totalDue : 0,
          status: inst.paid ? 'PAID' : 'PENDING',
          paidAt: inst.paid ? dueDate : null,
        },
      });

      if (inst.paid) {
        const transaction = await prisma.loanTransaction.create({
          data: {
            transactionId: `${TXN_ID_PREFIX}${letter}-${inst.installmentNo}`,
            loanId: loan.id,
            centerId: center.id,
            branchId: branch.id,
            clientId,
            amount: totalDue,
            type: 'REPAYMENT',
            paymentMode: 'CASH',
            collectedById: fdo.id,
            postedAt: dueDate,
            transactionDate: dueDate,
            principalAmount: principalPerInstallment,
            interestAmount: interestPerInstallment,
            feesAmount: 0,
            penaltyAmount: 0,
            collectionType: 'Demand Collection',
            status: 'APPROVED',
            approvedById: bm.id,
            approvedAt: dueDate,
          },
        });

        await prisma.loanTransactionLine.create({
          data: {
            transactionId: transaction.id,
            scheduleId: schedule.id,
            installmentNo: inst.installmentNo,
            principalAmount: principalPerInstallment,
            interestAmount: interestPerInstallment,
            lineTotal: totalDue,
          },
        });
      }
    }

    console.log(`✅ Loan ${loan.loanNumber} (${clientId}) — ${scenarioLabel}`);
  }

  // Scenario A: clean history, one installment due exactly today -> Demand only
  await createLoan({
    letter: 'A',
    clientId: clients[0].id,
    product: weeklyProduct,
    frequency: 'WEEKLY',
    tenureMonths: 3,
    scenarioLabel: 'clean history, installment #3 due TODAY -> shows under Demand only',
    plan: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
      const dueYmd = addDaysYmd(todayYmd, (n - 3) * 7);
      return { installmentNo: n, dueYmd, paid: n < 3 };
    }),
  });

  // Scenario B: one missed installment + one due today -> Arrear + Demand
  await createLoan({
    letter: 'B',
    clientId: clients[1].id,
    product: weeklyProduct,
    frequency: 'WEEKLY',
    tenureMonths: 3,
    scenarioLabel: 'installment #2 missed (arrear) + #3 due TODAY -> shows under both Arrear and Demand',
    plan: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
      const dueYmd = addDaysYmd(todayYmd, (n - 3) * 7);
      return { installmentNo: n, dueYmd, paid: n === 1 };
    }),
  });

  // Scenario C: three missed installments, none due today -> Arrear only
  await createLoan({
    letter: 'C',
    clientId: clients[2].id,
    product: weeklyProduct,
    frequency: 'WEEKLY',
    tenureMonths: 3,
    scenarioLabel: 'installments #1-3 missed (arrears), next due in the future -> shows under Arrear only',
    plan: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
      // installment #1 due -17d, #2 due -10d, #3 due -3d, #4 due +4d (future) — never lands on "today".
      const dueYmd = addDaysYmd(todayYmd, n * 7 - 24);
      return { installmentNo: n, dueYmd, paid: false };
    }),
  });

  // Scenario D: daily loan — two missed days + one due today -> Arrear + Demand
  await createLoan({
    letter: 'D',
    clientId: clients[3].id,
    product: dailyProduct,
    frequency: 'DAILY',
    tenureMonths: 2,
    scenarioLabel: 'daily loan, days -2/-1 missed (arrears) + today due -> shows under both Arrear and Demand',
    plan: Array.from({ length: 50 }, (_, i) => {
      const n = i + 1; // installment 6 lands on "today"
      const dueYmd = addDaysYmd(todayYmd, n - 6);
      return { installmentNo: n, dueYmd, paid: n < 4 };
    }),
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Demo login (Today Demand Collection page):');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🆔 FDO Employee ID: ${fdo.employeeId}`);
  console.log(`🔑 Password:        ${demoPassword}`);
  console.log(`🏢 Branch:          ${branch.name} (${branch.code})`);
  console.log(`🏬 Center:          ${center.name} (meeting day: ${center.meetingDay})`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Loan A → Demand Collection only');
  console.log('Loan B → Arrear Collection + Demand Collection');
  console.log('Loan C → Arrear Collection only');
  console.log('Loan D → Arrear Collection + Demand Collection (daily)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding demand-collection demo data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
