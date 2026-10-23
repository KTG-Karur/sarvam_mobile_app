/**
 * One-off import of "Active Employees Master Sheet" into EXISTING employees, matched by `Emp User ID`
 * (= User.employeeId, case-insensitive).
 *
 *   npm run db:seed:employee-master -- "Active Employees Master Sheet 17.10.2026 (1).xlsx"            # dry run (default)
 *   npm run db:seed:employee-master -- "Active Employees Master Sheet 17.10.2026 (1).xlsx" --apply    # write
 *   ... --overwrite   replace values that are already filled (default: only fill empty fields)
 *   ... --allow-remote   run against a non-localhost DATABASE_URL
 *
 * - Never creates users. Sheet rows with no matching employee are only reported.
 * - Fills: designation, department, joining date, email, UAN, ESI, Aadhaar, PAN, Voter ID, DL, DOB, gender,
 *   marital status, blood group, emergency contact mobile, address (+ pincode), bank name / IFSC / account number,
 *   and the monthly CTC (EmployeeCtcMaster + EmployeeCtcHistory).
 * - Never touches: name, mobile number (unique login key — differences are reported), branch (differences are
 *   reported), role, password, active flag. Invalid values (bad Aadhaar / PAN / IFSC / UAN format) are skipped
 *   and reported rather than written.
 * - Idempotent: a second run finds nothing left to fill.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import * as X from 'xlsx';
import { parseKolkataAttendanceDateYmd } from '../../app/lib/branch-lock';

const prisma = new PrismaClient();

const PATTERNS = {
    PAN: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
    AADHAAR: /^\d{12}$/,
    IFSC: /^[A-Z]{4}0[A-Z0-9]{6}$/,
    UAN: /^\d{12}$/,
    EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const digits = (v: unknown) => clean(v).replace(/\D/g, '');
const isEmpty = (v: unknown) => v === null || v === undefined || String(v).trim() === '';

/** "21-Sep-26" / "28-Feb-92" -> YYYY-MM-DD (2-digit years <= 40 are 20xx, otherwise 19xx). */
function ymdFromSheet(v: unknown): string | null {
    const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(clean(v));
    if (!m || !MONTHS[m[2].toLowerCase()]) return null;
    const yy = Number(m[3]);
    const y = m[3].length === 4 ? yy : yy <= 40 ? 2000 + yy : 1900 + yy;
    return `${y}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function normalizeBloodGroup(v: unknown): string | null {
    const s = clean(v).toUpperCase().replace(/\s+/g, '');
    if (!s) return null;
    // the sheet writes A positive as "A1+" in places; the app uses the plain ABO+Rh form
    const m = /^(A1B|AB|A1|A|B|O)([+-])$/.exec(s);
    if (!m) return null;
    const group = m[1] === 'A1' ? 'A' : m[1] === 'A1B' ? 'AB' : m[1];
    return `${group}${m[2]}`;
}

async function main() {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const overwrite = args.includes('--overwrite');
    const file = args.find((a) => !a.startsWith('--')) ?? 'prisma/seeders/data/employee-master.xlsx';

    const url = new URL((process.env.DATABASE_URL ?? '').replace(/^postgres(ql)?:/, 'http:'));
    console.log(`Target DB: ${url.hostname}${url.pathname} — ${apply ? 'APPLY' : 'DRY RUN'}${overwrite ? ', overwrite' : ', fill-empty-only'}`);
    if (url.hostname !== 'localhost' && !args.includes('--allow-remote')) throw new Error('Refusing to run against a non-localhost DB without --allow-remote.');

    const wb = X.readFile(file);
    const rows = X.utils
        .sheet_to_json<Record<string, string>>(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: '', range: 1 })
        .filter((r) => clean(r['Emp User ID']));

    const [users, designations, departments, admin] = await Promise.all([
        prisma.user.findMany({ include: { branch: { select: { code: true } }, employeeCtcMaster: true } }) as unknown as Promise<
            (Prisma.UserGetPayload<object> & { branch: { code: string } | null; employeeCtcMaster: { monthlyCtc: Prisma.Decimal } | null })[]
        >,
        prisma.designation.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
        prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
        prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } }),
    ]);
    if (!admin) throw new Error('No active ADMIN user to attribute CTC history to.');

    const byEmpId = new Map(users.map((u) => [clean(u.employeeId).toUpperCase(), u]));
    const designationBy = new Map(designations.map((d) => [norm(d.name), d.id]));
    const departmentBy = new Map(departments.map((d) => [norm(d.name), d.id]));

    const stats = new Map<string, number>();
    const bump = (k: string) => stats.set(k, (stats.get(k) ?? 0) + 1);
    const notes: string[] = [];
    const unmatched: string[] = [];
    let touched = 0;

    for (const r of rows) {
        const empId = clean(r['Emp User ID']).toUpperCase();
        const label = `${empId} ${clean(r['Emp Name'])}`;
        const u = byEmpId.get(empId);
        if (!u) {
            unmatched.push(label);
            continue;
        }

        const patch: Record<string, unknown> = {};
        // sets a field only when it is empty (or --overwrite) and the value is valid
        const put = (field: string, value: unknown, current: unknown) => {
            if (value === null || value === undefined || value === '') return;
            if (!isEmpty(current) && !overwrite) return;
            patch[field] = value;
            bump(field);
        };
        const checked = (field: string, raw: string, re: RegExp, current: unknown) => {
            if (!raw) return;
            if (!re.test(raw)) {
                notes.push(`${label}: ${field} "${raw}" has an invalid format — skipped`);
                return;
            }
            put(field, raw, current);
        };

        // designation / department by name (punctuation / case-insensitive)
        const desName = clean(r['Designation']);
        if (desName) {
            const id = designationBy.get(norm(desName));
            if (id) put('designationId', id, u.designationId);
            else notes.push(`${label}: designation "${desName}" not found in master — skipped`);
        }
        const depName = clean(r['Departments']);
        if (depName) {
            const id = departmentBy.get(norm(depName));
            if (id) put('departmentId', id, u.departmentId);
            else notes.push(`${label}: department "${depName}" not found in master — skipped`);
        }

        const doj = ymdFromSheet(r['Date of Joining']);
        if (doj && (isEmpty(u.dateOfJoining) || overwrite)) {
            patch.dateOfJoining = parseKolkataAttendanceDateYmd(doj);
            bump('dateOfJoining');
        }
        const dobYmd = ymdFromSheet(r['DOB']);
        if (dobYmd && (isEmpty(u.dob) || overwrite)) {
            patch.dob = parseKolkataAttendanceDateYmd(dobYmd);
            bump('dob');
        }

        const email = clean(r['EmailID']).toLowerCase();
        if (email) checked('email', email, PATTERNS.EMAIL, u.email);
        checked('uanNumber', digits(r['PF-UAN']), PATTERNS.UAN, u.uanNumber);
        put('esiNumber', digits(r['ESI']) || null, u.esiNumber);
        checked('aadhaarNumber', digits(r['Aadhar ']), PATTERNS.AADHAAR, u.aadhaarNumber);
        checked('panNumber', clean(r['PAN']).toUpperCase(), PATTERNS.PAN, u.panNumber);
        put('voterIdNumber', clean(r['Voter ID']).toUpperCase() || null, u.voterIdNumber);
        put('dlNumber', clean(r['DrivingLicence']).toUpperCase() || null, u.dlNumber);

        const gender = clean(r['Gender']).toUpperCase();
        if (gender === 'MALE' || gender === 'FEMALE') put('gender', gender, u.gender);
        const marital = clean(r['Marital status']).toUpperCase();
        if (marital === 'M') put('maritalStatus', 'MARRIED', u.maritalStatus);
        else if (marital === 'U') put('maritalStatus', 'SINGLE', u.maritalStatus);
        const blood = normalizeBloodGroup(r['Blood Group']);
        if (clean(r['Blood Group']) && !blood) notes.push(`${label}: blood group "${clean(r['Blood Group'])}" not recognised — skipped`);
        put('bloodGroup', blood, u.bloodGroup);

        const emergency = digits(r['Emergency Contact Number']);
        if (emergency.length === 10) put('emergencyContactMobile', emergency, u.emergencyContactMobile);

        const addr = clean(r['Address']);
        const pin = digits(r['Pincode']);
        if (addr) put('address', pin && !addr.includes(pin) ? `${addr}, ${pin}` : addr, u.address);

        put('bankName', clean(r['Bank Name']).toUpperCase() || null, u.bankName);
        checked('bankIfscCode', clean(r['IFSC Code']).toUpperCase(), PATTERNS.IFSC, u.bankIfscCode);
        put('bankAccountNumber', digits(r['Account Numner']) || null, u.bankAccountNumber);

        // reported only
        const sheetMobile = digits(r['Mobile Number']);
        if (sheetMobile && sheetMobile !== u.mobileNumber) notes.push(`${label}: mobile differs (db ${u.mobileNumber} / sheet ${sheetMobile}) — not changed`);
        const sheetBranch = clean(r['Branch']);
        const branchCode = /^head/i.test(sheetBranch) ? 'HO' : sheetBranch.split('-')[0].replace(/^0+/, '');
        if (branchCode && (u.branch?.code ?? '') !== branchCode) notes.push(`${label}: branch differs (db ${u.branch?.code ?? '—'} / sheet ${sheetBranch}) — not changed`);

        const ctc = Number(String(r['Month CTC Pay']).replace(/,/g, ''));
        const needsCtc = Number.isFinite(ctc) && ctc > 0 && (!u.employeeCtcMaster || (overwrite && Number(u.employeeCtcMaster.monthlyCtc) !== ctc));

        if (Object.keys(patch).length === 0 && !needsCtc) continue;
        touched++;
        if (needsCtc) bump('monthlyCtc');
        if (!apply) continue;

        await prisma.$transaction(async (tx) => {
            if (Object.keys(patch).length > 0) await tx.user.update({ where: { id: u.id }, data: patch });
            if (needsCtc) {
                const from = u.employeeCtcMaster ? u.employeeCtcMaster.monthlyCtc : null;
                await tx.employeeCtcMaster.upsert({
                    where: { employeeId: u.id },
                    update: { monthlyCtc: ctc, updatedById: admin.id },
                    create: { employeeId: u.id, monthlyCtc: ctc, updatedById: admin.id },
                });
                await tx.employeeCtcHistory.create({
                    data: {
                        employeeId: u.id,
                        fromMonthlyCtc: from,
                        toMonthlyCtc: ctc,
                        effectiveDate: parseKolkataAttendanceDateYmd('2026-10-17'),
                        source: 'MANUAL_EDIT',
                        remarks: 'Seeded from Active Employees Master Sheet 17.10.2026',
                        changedById: admin.id,
                    },
                });
            }
        });
    }

    console.log(`\nSheet rows: ${rows.length} | matched employees: ${rows.length - unmatched.length} | employees ${apply ? 'updated' : 'that would be updated'}: ${touched}`);
    console.log('Field counts:', Object.fromEntries([...stats.entries()].sort()));
    console.log(`\nNo matching employee (${unmatched.length}):`, unmatched);
    console.log(`\nNotes (${notes.length}):`);
    notes.forEach((n) => console.log(' -', n));
    if (!apply) console.log('\nDry run only — re-run with --apply to write.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
