/**
 * One-off legacy import of existing staff loans from "Employee Staff Loan Details.xlsx" (Payroll Sep'26 sheet).
 *
 *   npm run db:seed:staff-loans -- "Employee Staff Loan Details.xlsx" [--dry-run]
 *
 * - Creates (if missing) the "Legacy Staff Loan" scheme and a LOAN workflow config whose salary day is 31
 *   (last day of the month; the app moves a Sunday month-end to the Saturday before).
 * - Per sheet row creates an ACTIVE SALARY-recovery StaffLoan, its 10 schedule rows, the DISBURSEMENT
 *   transaction and one POSTED CASH_BANK_RECOVERY (ADJUSTMENT) transaction + allocation per installment already
 *   paid (the DB forbids SALARY_RECOVERY without a payroll record), so the
 *   outstanding principal equals the sheet's "O/S Principal Balance".
 * - Idempotent: stable idempotency keys; a loan whose disbursement key exists is skipped. Re-run after adding
 *   missing employees.
 * - Refuses to run unless DATABASE_URL points at localhost / ktg. No GL vouchers are posted (legacy data).
 */
import { Prisma, PrismaClient } from '@prisma/client';
import * as X from 'xlsx';
import { buildSalaryDueDates } from '../../app/lib/staff-loans/salary-schedule';
import { formatStaffLoanNumber, totalFlatInterest } from '../../app/lib/staff-loans/application';
import { schemeSchema } from '../../app/lib/staff-loans/configuration';

const SCHEME_CODE = 'LEGACY-FLAT-12';
const SALARY_DAY = 31;
const ANNUAL_RATE = 12; // sheet's "10%" = 10% of principal over 10 months => 12% p.a. flat
const prisma = new PrismaClient();

const num = (v: unknown) => Number(String(v ?? '').replace(/,/g, '').trim());
function ymdFromSheet(v: string): string {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(v).trim());
    if (!m) throw new Error(`Unrecognised date "${v}"`);
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const file = args.find(a => !a.startsWith('--'));
    if (!file) throw new Error('Pass the xlsx path as the first argument.');

    const url = new URL((process.env.DATABASE_URL ?? '').replace(/^postgres(ql)?:/, 'http:'));
    const dbName = url.pathname.replace('/', '');
    console.log(`Target DB: ${url.hostname}/${dbName}${dryRun ? ' (dry run)' : ''}`);
    if (url.hostname !== 'localhost' || dbName !== 'ktg') throw new Error('Refusing to run: target must be localhost/ktg.');

    const wb = X.readFile(file);
    const rows = X.utils.sheet_to_json<Record<string, string>>(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: '' })
        .filter(r => String(r['Emp User Num']).trim());

    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!admin) throw new Error('No active ADMIN user to own the scheme / transactions.');
    const hoBranch = await prisma.branch.findFirst({ where: { code: 'HO' }, select: { id: true } });

    // Plan every row first so a bad row is reported before anything is written.
    type Plan = { empNo: string; employeeId: string; branchId: string; principal: Prisma.Decimal; interest: Prisma.Decimal; months: number; disbYmd: string; dueDates: string[]; paid: number; osPrincipal: number };
    const plans: Plan[] = [];
    const skipped: string[] = [];
    for (const r of rows) {
        const empNo = String(r['Emp User Num']).trim();
        const label = `${empNo} ${String(r['Emp Name']).trim()}`;
        const user = await prisma.user.findUnique({ where: { employeeId: empNo }, select: { id: true, isActive: true, branchId: true } });
        if (!user) { skipped.push(`${label}: employee not found in DB`); continue; }
        const branchId = user.branchId ?? hoBranch?.id;
        if (!branchId) { skipped.push(`${label}: employee has no branch and no HO fallback`); continue; }

        const months = parseInt(String(r['Tenure']), 10);
        const principal = new Prisma.Decimal(num(r['Loan Amount']));
        const interest = totalFlatInterest(principal, months, 'FLAT', ANNUAL_RATE);
        if (!interest.equals(num(r['Total Interest']))) { skipped.push(`${label}: interest ${interest} != sheet ${num(r['Total Interest'])}`); continue; }
        const disbYmd = ymdFromSheet(r['Loan Disbursed Date']);
        const dueDates = buildSalaryDueDates(disbYmd, 'THIS_MONTH', SALARY_DAY, months);
        if (dueDates[months - 1].slice(0, 7) !== ymdFromSheet(r['Loan End Date']).slice(0, 7)) { skipped.push(`${label}: last due ${dueDates[months - 1]} not in sheet end month ${r['Loan End Date']}`); continue; }

        const perInstallment = num(r['Due Principal']); // sheet column = principal per installment
        const os = num(r['O/S Principal Balance']);
        const paid = (principal.toNumber() - os) / perInstallment;
        if (!Number.isInteger(paid) || paid < 0 || paid > months) { skipped.push(`${label}: O/S ${os} is not a whole number of installments (${paid})`); continue; }
        const dueByPayroll = dueDates.filter(d => d <= '2026-09-30').length;
        if (dueByPayroll !== paid) console.warn(`  note ${label}: ${paid} paid per O/S, ${dueByPayroll} installments due by Sep'26 — using O/S`);
        plans.push({ empNo, employeeId: user.id, branchId, principal, interest, months, disbYmd, dueDates, paid, osPrincipal: os });
    }
    console.log(`Rows: ${rows.length}, importable: ${plans.length}, skipped: ${skipped.length}`);
    skipped.forEach(s => console.log(`  SKIP ${s}`));
    if (dryRun) { plans.forEach(p => console.log(`  ${p.empNo} ${p.principal} disb ${p.disbYmd} dues ${p.dueDates[0]}..${p.dueDates[p.months - 1]} paid ${p.paid}/${p.months} O/S ${p.osPrincipal}`)); return; }

    // Scheme + salary-date workflow config.
    const scheme = await prisma.staffLoanScheme.upsert({
        where: { code: SCHEME_CODE },
        update: {},
        create: {
            code: SCHEME_CODE, name: 'Legacy Staff Loan (Flat 12% p.a.)', description: 'Imported legacy staff loans', minimumServiceMonths: 0,
            minimumSalaryPerMonth: 0, amountBasis: 'FIXED_AMOUNT', maximumAmount: 100000, maximumTenureMonths: 10, maximumActiveLoans: 1,
            interestType: 'FLAT', annualInterestRate: ANNUAL_RATE, isActive: false, createdById: admin.id,
        },
    });
    const snapshot = schemeSchema.parse({
        code: scheme.code, name: scheme.name, description: scheme.description ?? '', minimumServiceMonths: 0, minimumSalaryPerMonth: 0,
        amountBasis: 'FIXED_AMOUNT', maximumAmount: Number(scheme.maximumAmount), salaryMultiplier: null, maximumTenureMonths: scheme.maximumTenureMonths,
        maximumActiveLoans: scheme.maximumActiveLoans, interestType: 'FLAT', annualInterestRate: ANNUAL_RATE, isActive: scheme.isActive,
        branchIds: [], departmentIds: [], roleIds: [], salaryBasisComponentIds: [],
    });
    if (!(await prisma.staffLoanWorkflowConfig.findFirst({ where: { kind: 'LOAN' } }))) {
        await prisma.staffLoanWorkflowConfig.create({ data: { kind: 'LOAN', name: 'Salary date (legacy import)', isActive: false, salaryDay: SALARY_DAY, createdById: admin.id } });
        console.log(`Created LOAN workflow config (salaryDay ${SALARY_DAY}, inactive, no stages).`);
    }

    let created = 0;
    for (const p of plans) {
        const disbKey = `SEED-SLDISB-${p.empNo}-${p.disbYmd}`;
        if (await prisma.staffLoanTransaction.findUnique({ where: { idempotencyKey: disbKey }, select: { id: true } })) { console.log(`  exists ${p.empNo}`); continue; }
        await prisma.$transaction(async tx => {
            const seq = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('staff_loan_number_seq') AS n`;
            const disb = new Date(p.disbYmd);
            const loan = await tx.staffLoan.create({
                data: {
                    loanNumber: formatStaffLoanNumber(seq[0].n), employeeId: p.employeeId, branchId: p.branchId, schemeId: scheme.id, schemeVersion: scheme.version,
                    schemeSnapshot: snapshot, status: 'ACTIVE', purpose: 'Legacy staff loan (imported)', remarks: 'Imported from Employee Staff Loan Details.xlsx',
                    requestedAmount: p.principal, approvedAmount: p.principal, tenureMonths: p.months, interestType: 'FLAT', annualInterestRate: ANNUAL_RATE,
                    recoveryMethod: 'SALARY', proposedDisbursementDate: disb, firstDueDate: new Date(p.dueDates[0]),
                    submittedAt: disb, approvedAt: disb, disbursedAt: disb,
                    closedAt: p.paid === p.months ? new Date(p.dueDates[p.months - 1]) : null,
                },
            });
            // Same paise distribution as disburseLoan.
            const pp = p.principal.mul(100), ip = p.interest.mul(100);
            const baseP = pp.div(p.months).floor(), baseI = ip.div(p.months).floor();
            const extraP = pp.mod(p.months).toNumber(), extraI = ip.mod(p.months).toNumber();
            const sch = Array.from({ length: p.months }, (_, i) => ({
                loanId: loan.id, installmentNo: i + 1, dueDate: new Date(p.dueDates[i]),
                principalDue: baseP.plus(i < extraP ? 1 : 0).div(100), interestDue: baseI.plus(i < extraI ? 1 : 0).div(100),
            }));
            await tx.staffLoanSchedule.createMany({ data: sch });
            const rowsDb = await tx.staffLoanSchedule.findMany({ where: { loanId: loan.id }, orderBy: { installmentNo: 'asc' } });
            await tx.staffLoanTransaction.create({
                data: { loanId: loan.id, type: 'DISBURSEMENT', status: 'POSTED', transactionDate: disb, amount: p.principal, paymentMode: 'BANK_TRANSFER', reference: 'LEGACY-IMPORT', remarks: 'Legacy import', idempotencyKey: disbKey, createdById: admin.id, postedAt: new Date() },
            });
            for (let i = 0; i < p.paid; i++) {
                const s = rowsDb[i];
                const t = await tx.staffLoanTransaction.create({
                    data: { loanId: loan.id, type: 'CASH_BANK_RECOVERY', status: 'POSTED', transactionDate: s.dueDate, amount: s.principalDue.plus(s.interestDue), paymentMode: 'ADJUSTMENT', reference: 'LEGACY-SALARY-DEDUCTION', remarks: `Legacy salary deduction (imported) — installment #${s.installmentNo}`, idempotencyKey: `SEED-SLREC-${p.empNo}-${p.disbYmd}-${s.installmentNo}`, createdById: admin.id, postedAt: new Date() },
                });
                await tx.staffLoanRepaymentAllocation.create({ data: { loanId: loan.id, transactionId: t.id, scheduleId: s.id, principal: s.principalDue, interest: s.interestDue } });
            }
            console.log(`  + ${loan.loanNumber} ${p.empNo} paid ${p.paid}/${p.months}`);
        }, { timeout: 30000 });
        created++;
    }
    console.log(`Done. Created ${created} loan(s).`);
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
