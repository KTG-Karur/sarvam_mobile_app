# HR Module Analysis — Payroll, Salary, Performance, Staff Loans

Scope: full HR module, deep-dive on **Salary / Payroll**, **Performance**, **Staff Loans** and the menus that feed them.
Method: read schema, API routes, service layer and nav/permission config; ran `npx vitest run app/lib/staff-loans` (5 files, 87 tests, all pass).
UI components (~8k lines of TSX) were **not** read line by line — the logic lives in the service/API layer, which was.
Status legend: ✅ verified in code. All follow-up checks are resolved — see §5.

---

## 1. Module inventory

| Area | Menu (nav config) | Page → component | API | Data model |
|---|---|---|---|---|
| Salary Components | Payroll & Compensation → Salary (`navigation.config.ts:794`) | `hr/salary` → `SalaryDetailsClient` (398 loc) | `api/payroll/salary-details` | `SalaryComponent` (schema:3107) |
| Salary Master | → Salary Master (`:800`) | `hr/salary-master` → `SalaryMasterClient` (439) | `api/payroll/salary-master` | `EmployeeSalaryMaster` (:3122) |
| Salary Pay | → Salary Pay (`:805`) | `hr/salary-pay` → `SalaryPayClient` (469) | `api/payroll/salary-pay` | `SalaryPayRecord` + `SalaryPayLineItem` (:3137, :3157) |
| Payroll | → Payroll (`:811`) | `hr/payroll` → `PayrollClient` (798) | **none** | none |
| Payslip | Reports → Employee → Payslip | `reports/employee/payslip` → `PayslipClient` | `api/payroll/payslip` | reads `SalaryPayRecord` |
| Staff Loans | Apply / Loan Management / Repayments & Settlement (`:819-844`) | `hr/staff-loans/*` → 3 pages (1050 / 842 / 886 loc) | `api/hr/staff-loans/*` (8 routes) | 9 models, schema:5045-5314 |
| Staff Loan masters | Masters → Schemes, Approval Workflow (`:468-474`) | `masters/staff-loan-*` | `api/admin/staff-loan-schemes`, `staff-loan-workflow` | `StaffLoanScheme`, `StaffLoanWorkflowConfig/Stage` |
| Performance | Goals / Review / Analysis (`:845-869`) | `hr/performance/*` → `GoalList` `ReviewForm` `PerformanceAnalysis` | `api/hr/performance/{goals,reviews,analysis}` | `PerformanceGoal`, `PerformanceReview` (schema:1030, :1054) |
| Incentive (feeds payroll) | Reports / MIS | `mis-reports`, `reports/employee/fdo-performance` | `services/incentive-report.service` | `IncentiveConfig`, `IncentiveSlab` (schema:4487, :4501) |

**Associated HR modules** (inputs to the focus areas): Employee master + Department/Designation (`User`, payslip identity, loan eligibility via `dateOfJoining`), Attendance (`Attendance`, `lopLocked`), Leave + Permission (permission hours → payroll deduction), Working Hours (`attendance-config`), Lifecycle (Confirmation / Promotion / Transfer / Exit), Live Tracking, HR Reports hub.

### Two unrelated "performance" systems — do not conflate
1. **HR appraisal** (`PerformanceGoal` / `PerformanceReview`): manual 1–5 rating + free-text goals. Touches nothing financial.
2. **Incentive engine** (`getIncentiveReportData`, DCB/loan-performance, **FDO only**): the only "performance" that reaches pay, via auto-fill in `salary-pay/route.ts:51-69`.
Appraisal ratings do **not** influence salary, increments, promotions or incentives anywhere in code. If the goal is "performance drives pay", that link has to be built.

---

## 2. Defects and gaps, ranked

### CRITICAL

**C1. Staff-loan `SALARY` recovery is collected but never executed.** ✅
- `recoveryMethod` is captured on apply (`application-service.ts:218,251`) and shown in every grid.
- `StaffLoanTransactionType.SALARY_RECOVERY` and `FINAL_SETTLEMENT_RECOVERY` have **zero writers**; `StaffLoanTransaction.salaryPayRecordId` (schema:5262) is **never set** (only unrelated hit: `salary-pay/route.ts:209`).
- `recordRepayment` always writes `CASH_BANK_RECOVERY` (`application-service.ts:739`), regardless of the loan's method.
- `salary-pay` never reads `StaffLoan`/`StaffLoanSchedule`. A "Staff Loan" deduction only exists if someone hand-types it into the Deductions grid.
- Net effect: the salary-deduction path is UI + schema, no engine. Loan schedules stay unpaid after payroll runs; payroll deducts unverified amounts.

**C2. Salary/payroll write APIs have no role or branch gate.** ✅
- `salary-pay` GET `:88` / POST `:185`, `salary-master` GET `:19` / POST `:58`, `salary-details` GET `:14` / POST `:28` / DELETE `:76` all use bare `withAuth`.
- Only the *pages* are restricted (`server-route-protection.ts:75-77` → AREA_MANAGER; `salary-pay` page uses client-side `ProtectedRoute`, not even `protectServerRoute`).
- `proxy.ts:11-15` states it is CORS-only and that protection is route-level, so nothing else stops a direct call. **Any authenticated user (e.g. an FDO) can read or write any employee's salary master and pay record, and create/delete salary components.**
- Contrast `payslip/route.ts:19,67-70`, which does it right (`withRole` + `getPermittedBranchIds`). CLAUDE.md requires `withRole` and branch scoping on every route.

**C3. Salary pay trusts the client for pay math.** ✅ `salary-pay/route.ts:76-81,195-201`
- Totals are computed from client-sent `amount` **and client-sent `type`** per component; the server never looks up `SalaryComponent.type` or compares with the master. A caller can flip a deduction into an earning.

### HIGH

**H1. No approval, lock, or audit on payroll.** ✅
- `SalaryPayRecord.status` is a free `String @default("PAID")` (schema:3147); submit == paid. Every other financial flow in this system is maker-checker.
- POST re-submit silently overwrites a PAID record (`salary-pay/route.ts:207-228`); no lock after payment, no history of who/what changed.
- `paidOn` in the payslip is `createdAt` (`payslip/route.ts:126`), so it does not move on edit.

**H2. Overwrite path is non-atomic.** ✅ `salary-pay/route.ts:207-226` — `deleteMany` then `update` as separate calls, no `$transaction`. A failure between them leaves a record with old totals and no line items. CLAUDE.md: never partial commits.

**H3. No GL posting for payroll or staff loans.** ✅
- `StaffLoanVoucher` (schema:5304) links to `FinancialTransaction`, but nothing in `app/lib/services` references staff loans; disbursement (`:422-436`), repayment and settlement create no voucher. Salary pay creates none either.
- `SalaryPayClient` fetches `/accounts/self` (`:112`) but the payload (`:195-205`) never sends an account; API has no field for it. `paymentType` is a free string.
- No `[POSTING:...]` idempotency marker use, unlike `accounting-posting.service.ts`.

**H4. Payroll ignores attendance except permission hours.** ✅ (for `salary-pay`, the only payroll route)
- No absent / LOP / half-day deduction; `PAYROLL_DAYS_PER_MONTH = 26` hardcoded (`:22`). Attendance `lopLocked` and the LOP leave type exist but payroll never consumes them.
- Auto-fill matches components by **name regex** (`/incentive/i`, `/permission deduction/i`, `:139-140`). No seeder creates any `SalaryComponent` (only the table migration references `salary_components`), so the auto-fills work only if an admin happens to type components with matching names on the Salary screen — fragile, silently absent otherwise. The same applies to the report's `'Staff Loan'` / `'Staff Advance'` exact-name match.

**H5. Appraisal data is readable by any authenticated user in the branch.** ✅
- `goals/route.ts:36` and `reviews/route.ts:35`: `?scope=team` has **no permission check** (`getPermittedBranchIds` only). An FDO can list every colleague's goals and reviews — including **DRAFT** reviews, ratings and comments (no status filter on the query).
- `analysis/route.ts:13` is `withAuth` only, though the menu limits it to ADMIN/AM/HR (`navigation.config.ts:866`).
- `goals/[id]/route.ts:32`: anyone holding `hr-performance:edit` can edit any employee's goal org-wide (no branch scope); the goal owner may always edit their own goal, so can mark it `ACHIEVED` or change a manager-assigned goal.

**H6. Staff loans are not wired to employee exit.** ✅
- `StaffLoan.exitReviewRequired` (schema:5190) has **no reader or writer** anywhere in `app/` or `components/`; nothing in `api/hr/exit-requests`, `transfers`, or `employees` references staff loans. An employee with an ACTIVE loan can be cleared and exited; `FINAL_SETTLEMENT_RECOVERY` is unreachable.

**H7. Repayments and settlements post instantly, no maker-checker.** ✅ `recordRepayment` / `recordEarlySettlement` write `status: 'POSTED'` directly (`:738,878`); `PENDING`/`REJECTED` statuses, the `REVERSAL` type and `reversalOfId` exist in schema but have **no writer** anywhere, so a wrongly posted repayment cannot be corrected. Collection flow elsewhere in the system is approval-based.

### MEDIUM

**M1. Idempotency contract is unimplemented (narrower than it looks).** ✅ `idempotencyKey` is `@unique` with the documented intent "retries must return the original operation" (schema:5259), but keys are `REPAY-${loan.id}-${randomUUID()}` (`:746`), same in `disburseLoan` `:432` and `recordEarlySettlement` `:884`. Serializable isolation + the `version` check **do** prevent a concurrent duplicate. The real gap: a client retrying after a timeout gets **409** rather than the original result, and cannot tell success from failure. Fix = client-supplied key persisted on first attempt and returned on replay.

**M2. Schedule date drift on 29th–31st.** ✅ `application-service.ts:405-409` — `dueDate.setMonth(getMonth()+i)` from the first date overflows (31 Jan + 1 month → 3 Mar), and `new Date('YYYY-MM-DD')` (UTC) mixed with local `setMonth` can shift a `@db.Date` by a day depending on server TZ. CLAUDE.md requires IST-aware helpers.

**M3. Early-settlement waiver is not recorded.** ✅ Loan is set `CLOSED` while future-interest schedule rows stay unallocated (`:890-911`); `futureInterestPolicy: 'WAIVE_FUTURE'` is a hardcoded string (`:683`). Nothing records the waived amount, so reports show phantom outstanding interest on closed loans and no approval covers the waiver.

**M4. Role-code inconsistency.** ✅ `application-access.ts` derives `isHR` from `role === 'HR' | 'HR_MANAGER'` (+ slugs `hr`/`hr-manager`), but nav `allowedRoles` use `'HR'`, `'HRM'`, `'CM-HR'` (`navigation.config.ts:823-841`). `HRM`/`CM-HR` users see the menu but `canApplyForOthers` is false unless a page grant exists. Same class of mismatch on Salary: nav/route-protection allow only `AREA_MANAGER` (`:797-809`, `server-route-protection.ts:75-77`) while `seed-rbac.ts` grants `hr-payroll:view/edit` to other roles (`:216,247,561`) — two permission systems that disagree; ADMIN is not in the static list.

**M5. Payslip content is placeholder.** ✅ `payslip/route.ts:114-115` — `designation: employee.role`, `department: 'General'` ("no dedicated dept field") although `Department`/`Designation` models exist and `performance/analysis` already reads `employee.department`. API is ADMIN/AM only (`:19`) and the Payslip report menu is `AREA_MANAGER` / `ADMIN_NON_HO_BRANCH_SWITCH` (`navigation.config.ts:1502`), so an **employee cannot see their own payslip**.

**M6. Dead / mock UI in the menu.** ✅
- `PayrollClient.tsx` (798 loc, menu "Payroll" for BM/AM): hardcoded mock employees (`:225-229`) and `apiClient.post('/payroll', …)` (`:255`) with `// TODO: Replace with actual API endpoint`; **no `app/api/payroll/route.ts` exists**. `apiClient` prefixes `/api` (`api-client.ts:10,75`) and on a non-JSON 404 returns `{ success: false }` instead of throwing (`:85-98`); `PayrollClient` ignores the result and always toasts "Payroll record created successfully" (`:275-278`). So the page **reports success while saving nothing**.
- `SalaryClient.tsx` (530 loc): no importer found in `app/` or `components/` → dead code.

**M7. Salary components are hard-deleted via raw SQL.** ✅ `salary-details/route.ts:40-43,86-89` — also purges inactive rows to "reuse" ids/names. FK from line items/master blocks deletion of used components (surfaces as a raw error), and `isActive` is never toggled by these routes, so there is no soft-delete path. `salaryId` is a hand-entered integer.

**M8. Salary master has no history.** ✅ Upsert overwrites (`salary-master/route.ts:68-85`); no effective date, no who/when, no link to Promotion/Confirmation (`api/hr/promotions`, `confirmations`, `transfers`, `exit-requests` never touch `employeeSalaryMaster`, so a promotion does not change pay). Staff-loan eligibility (`application-service.ts:83-91`) reads this master, so unaudited edits change loan limits.

**M9. Payroll can only be processed for the current calendar year.** ✅ `SalaryPayClient.tsx:54` sets `CURRENT_YEAR = new Date().getFullYear()` and uses it for both fetch (`:132`) and submit (`:198`); the month picker is labelled with it (`:309`). December payroll run in January cannot be created or corrected. Server side is the opposite extreme: `z.number().min(2020)` with no upper bound or period-closed rule (`salary-pay/route.ts:74`).

**M10. Staff-loan dates are client-supplied and not gated by branch working day.** ✅ `disbursementDate`, `firstDueDate`, `paymentDate`, `settlementDate` are format-only regexes (`application.ts:31,34,128,138`); nothing in `app/lib/staff-loans` references `getBranchWorkingDayWindow` / EOD. Backdated or future-dated postings are accepted, contrary to the CLAUDE.md EOD rule.

### LOW

- **L1.** `loanNumber` is `SL-${randomUUID()}` (`:265`) — unusable as a reference for staff/vouchers; use a branch/year sequence.
- **L2.** `allocationOrder` is a `const` typed as a union (`:733`); the `PRINCIPAL_FIRST` branch is dead. Interest-first is fixed policy, not configurable.
- **L3.** Performance pages contain logic and hardcoded role arrays (`hr/performance/goals/page.tsx`, `reviews/page.tsx`: `HR_STAFF_ROLES`) — violates "thin wrappers" and "use `usePermission()`".
- **L4.** Appraisal model is thin: no review cycle, no self-assessment, no per-goal weight/progress/actual value (`targetMetric` is free text), no goal→review link, no period validation (`end >= start`), no notifications.
- **L5.** No test files exist for payroll, salary or performance (staff-loans has 87 passing tests across 5 files, all mocked-Prisma unit tests — none exercise the salary path because it does not exist).

---

## 3. What needs building (dependency order)

1. **Lock down first (C2, C3, H5):** `withRole`/`checkPermission('hr-payroll', …)` + `getPermittedBranchIds` on all `api/payroll/*` writes; server looks up `SalaryComponent.type`; permission-gate `scope=team` and `analysis`.
2. **Payroll run model (H1, H2):** `SalaryPayStatus` enum (DRAFT → PENDING_APPROVAL → APPROVED → PAID), lock after PAID, `$transaction` on save, `paidAt`/`approvedBy`, change audit.
3. **Staff-loan ↔ payroll engine (C1):** in salary-pay GET, compute the month's due EMI from `StaffLoanSchedule` for `recoveryMethod = SALARY` loans and auto-fill a linked deduction line; on approval, post `SALARY_RECOVERY` `StaffLoanTransaction` + allocations in the same transaction and set `salaryPayRecordId`. Replace the name-matched "Staff Loan Deduction" report with a join to `StaffLoanTransaction`.
4. **GL (H3):** post salary and loan disbursement/recovery through `accounting-posting.service.ts` with `[POSTING:...]` markers; wire `StaffLoanVoucher`; add ledgers in `app/lib/constants/ledgers.ts`.
5. **Attendance → payroll (H4):** LOP/absent-day deduction from attendance; per-branch working-day calendar instead of the constant 26.
6. **Exit/loan integration (H6):** block or flag exit clearance on outstanding loans; set `exitReviewRequired`; final-settlement recovery from full-and-final.
7. **Performance (H5, L4):** cycles, weighted goals with actuals, self-assessment; decide whether ratings should drive increments/incentives, then link to promotion/salary master.
8. **Cleanup (M6, M4, M5):** remove `SalaryClient`, decide `PayrollClient` (replace with real payroll-run page or delete the menu entry), unify role codes, real department/designation on payslip, self-service payslip.

## 4. Not analysed in depth (named scope)
- `IncentiveConfig` / `IncentiveSlab` and `incentive-report.service.ts` — payroll consumes them via `resolveComputedIncentive`; managed from the incentive report/config screens.
- Staff-loan **masters** (schemes / approval workflow): `configuration-service.ts` is versioned with optimistic concurrency and covered by tests; screens not reviewed.
- Attendance, Leave, Permission, Lifecycle, Tracking internals — reviewed only where they touch the focus areas.

## 5. Verification log
| Question | Result |
|---|---|
| Does `PayrollClient`'s `/payroll` 404? | Yes — `apiClient` base is `/api`; no `app/api/payroll/route.ts`; failure returned as `{success:false}` and ignored. |
| Does any seeder create `SalaryComponent` rows? | No — only the table migration references `salary_components`; components are admin-entered. |
| `CURRENT_YEAR` in `SalaryPayClient` | `new Date().getFullYear()` — prior-year payroll unprocessable (M9). |
| Any writer for `REVERSAL` / `reversalOfId`? | None. |
| Do promotions/confirmations/transfers/exit touch salary master or staff loans? | No. |
| Payroll / salary / performance tests? | None. |
| Staff-loan tests | `npx vitest run app/lib/staff-loans` → 5 files, 87 tests pass. |
| Not run | App was not started and no API was called live; findings are from code reading. `tsc`/`lint` not run. |

## 6. Decisions needed before building
1. **Scope of "performance"**: keep HR appraisal separate, or make it drive increments/incentives (§1 note)?
2. **Payroll approval levels**: reuse the 3-level BM → AM → Admin GL pattern, or a shorter HR → Admin flow?
3. **Salary-recovery timing**: deduct the EMI due in the pay month, or all overdue instalments? Partial deduction when net pay is below the EMI?
4. **Who owns payroll**: today only `AREA_MANAGER` can reach the screens (`server-route-protection.ts:75-77`); confirm intended roles (HR / ADMIN?) and whether to move to dynamic RBAC (`hr-payroll:*`) instead of static role lists.
