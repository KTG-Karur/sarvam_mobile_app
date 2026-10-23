# Sarvam Charitable Trust — CLAUDE.md

## Project Overview

**Purpose:** Full-stack enterprise microfinance management system for Sarvan/Nidhi MFI. Manages the entire lending lifecycle: client enrollment → loan application → disbursement → collections → GL accounting → reporting.

**Tech Stack:** see `package.json` for the full dependency list and versions.
- **Auth:** Custom JWT (HS256) — access token 72 hr, refresh token 7 days; stored in httpOnly cookies + localStorage

---

## Folder Structure

See the repo tree (`ls`/`find`) for current directory layout — `app/api/`, `app/dashboard/`, `app/lib/`, `components/`, `prisma/`, `scripts/` are the top-level areas; domain subfolders under `app/lib/` and `components/` are self-descriptive.

**Page files are thin wrappers** — they only import + render a component from `components/[domain]/`. All logic lives in the component file.

---

## Key Commands

See `package.json` scripts for the standard dev/build/lint/test/db commands. Non-obvious ones:

```bash
npm run db:backfill:transaction-lines  # Backfill loan transaction line items
npm run db:check:demand-clientwise     # Diagnose client-wise demand issues
npm run db:diagnose:eod-attendance     # Diagnose EOD attendance problems
npm run postman:generate               # Generate Postman collection from all routes
```

> **After schema changes:** Stop dev server → `npm run db:push` → `npm run db:generate` → restart dev server (Windows DLL lock issue).

---

## Environment Variables

```env
# Database (dev DB name is "sarvam"; prod uses DigitalOcean managed PG with ?sslmode=require)
DATABASE_URL="postgresql://user:password@localhost:5432/sarvam"

# JWT Secrets (change in production)
JWT_SECRET="your-super-secret-jwt-key"
JWT_REFRESH_SECRET="your-super-secret-refresh-key"

# App URL (dev: http://localhost:3000; prod: https://sarvam.nidhimfi.com)
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# File Storage (Supabase S3-compatible)
STORAGE_ENDPOINT="https://xxxx.supabase.co/storage/v1/s3"
STORAGE_REGION="ap-southeast-1"
STORAGE_BUCKET="k3-microfinance"
STORAGE_ACCESS_KEY="..."
STORAGE_SECRET_KEY="..."

# Node environment
NODE_ENV="development"
```

---

## Coding Conventions

### API Routes
- All routes wrap handlers with `withAuth(handler)(request)` or `withRole(['ROLE'], handler)(request)`
- Always call `handleCorsPreflight()` in `OPTIONS` export
- Validate request body with Zod `.parse()` or `.safeParse()` — never trust raw input
- Return `errorResponse(message, status)` / `successResponse(data, message)` — never raw `NextResponse.json()`
- Pattern:
  ```typescript
  export async function POST(request: NextRequest) {
    return withRole(['BRANCH_MANAGER'], async (req, user) => {
      try {
        const body = await req.json();
        const data = mySchema.parse(body);
        // ... DB logic
        return successResponse(result, 'Created');
      } catch (error: any) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        return errorResponse(error.message || 'Failed', 500);
      }
    })(request);
  }
  ```

### Frontend API Calls
- Always use `apiClient.get<T>()` / `apiClient.post<T>()` — never raw fetch
- Always check `result.success` before accessing `result.data`
- Use `useToast()` for all user feedback (no window.alert)

### Components
- Dashboard pages are thin wrappers: `export default function PageRoute() { return <FeatureComponent /> }`
- Components manage their own data fetching via `apiClient` in `useEffect`
- Permission gating: use `usePermission()` hook, not hardcoded role strings
- Use `cn()` from `lib/utils` for conditional class merging

### Database (Prisma)
- Use `prisma.$transaction()` for multi-step writes — never partial commits
- Always scope queries to `branchId` for multi-tenancy correctness
- Use `select` to limit returned fields on large queries
- Unique constraints: prefer `@@unique` in schema over application-level dedup

### TypeScript
- Strict mode enabled — no `any` unless unavoidable (and comment why)
- Define response types with generics, not `any`
- Use Zod infer for form/API types: `type FormData = z.infer<typeof mySchema>`

---

## Important Business Logic

### User Roles (Base Roles + Dynamic RBAC)
| Role | Description |
|---|---|
| `ADMIN` | System-wide access |
| `BRANCH_MANAGER` | Manages one branch — disbursements, collections approval |
| `FDO` | Field Development Officer — creates loans, enrolls clients |
| `AREA_MANAGER` | Supervises multiple branches — Level 2 approval |
| `DIVISION_MANAGER` | Regional oversight |

The permission system is a dynamic RBAC/ABAC engine (not just the UserRole enum):
- Roles are DB-managed (`Role`, `Permission`, `RolePermission`, `UserRoleAssignment`) — admins can create custom roles
- ABAC conditions per permission: `branchScope`, `recordOwnership`, `timeRestriction`, `maxAmount`, `custom`
- Field-level access: `FieldPermission` (VISIBLE, READONLY, HIDDEN, MASKED)
- Report-level access: `ReportPermission` (canView, canExport, canPrint, maskFinancial)
- Cache versioning: `PermissionCacheVersion` for fast permission resolution
- Engine: `app/lib/permissions/engine.ts`, `types.ts`, `guards.ts`, `cache.ts`

### Multi-branch Assignment
- `AreaManagerBranch`: AM can manage multiple branches; one marked `isPrimary` for login context
- `UserBranchAccess`: per-user typed access per branch (FULL, OPERATIONAL, READONLY, REPORTING)
- Org hierarchy: `Region` → `Division` → `Area` → `Branch`

### Loan Lifecycle
```
FDO creates → PENDING_VERIFICATION
BM verifies → VERIFIED → PENDING_LEVEL1 → APPROVED_LEVEL1
AM approves → PENDING_LEVEL2 → APPROVED_LEVEL2
BM disburses → DISBURSED
```

### Client Approval (Dynamic, Config-Driven)
The client approval flow is configurable via `ClientWorkflowConfig` + `ClientWorkflowStage` (DB-managed):
```
FDO enrolls → PENDING_LEVEL_1 → PENDING_LEVEL_2 → ... → APPROVED
```
`ClientApprovalStatus` supports `PENDING_LEVEL_1` through `PENDING_LEVEL_5`. Stage count and role per stage are set in admin settings.

### Collection Flow
```
FDO collects cash → LoanTransaction (PENDING) → AM/BM approves → APPROVED → schedule updated → GL posted
```

### Financial Transactions (3-Level GL Approval)
```
Created → PENDING_APPROVAL → AM approves → PENDING_AM_APPROVAL → Admin approves → APPROVED
```
Types: `BANK_RECEIPT`, `BANK_PAYMENT`, `CASH_RECEIPT`, `CASH_PAYMENT`, `CONTRA`, `JOURNAL`
GL posting: `app/lib/services/accounting-posting.service.ts` — idempotency markers like `[POSTING:DISBURSEMENT:loanTxnId]`

### EOD (End-of-Day)
- Branch is locked to a `currentWorkingDate` (IST, Asia/Kolkata)
- All transactions validated against `getBranchWorkingDayWindow()` — reject if outside window
- BranchLock in DB prevents concurrent EOD and enforces business hours (9 AM–6 PM default)
- EOD gate utilities: `eod-collection-gates.ts`, `eod-disbursement-gates.ts`, `eod-center-meeting-gates.ts`, `eod-checklist-details.ts`

### Gold Loans
- Models: `GoldLoanDetail`, `GoldTransaction`, `GoldPrice`
- `GoldTransactionType`: TAKE (disbursement), GIVE (return)
- `GoldReturnStatus`: PENDING → APPROVED / REJECTED
- BM sets daily gold price per branch in master (`/dashboard/masters/gold-price`)
- BM manually enters karat type, gram count, gold value, and cash given at disbursement
- Gold return: BM initiates → AM approves; component `components/gold-return/`

### Foreclosure & Savings Refund (Maker-Checker)
- `ForeclosureRequest`: INITIATED → PENDING_APPROVAL → APPROVED / REJECTED
- `SavingsRefundRequest`: PENDING_APPROVAL → APPROVED / REJECTED
- BM creates foreclosure with outstanding snapshot; AM approves with locked amounts
- Core utility: `app/lib/foreclosure-workflow.ts` — `computeOutstandingForForeclosure()`

### Loan Death Marking
- Model: `LoanDeathMarking`; `DeceasedPersonType`: MEMBER or CO_APPLICANT
- Fields: deathDate, deathReason, placeOfDeath, demandRequired flag
- Triggers demand waiver workflow; death reports in `components/mis-reports/`

### Questionnaire Master
Reusable questionnaire builder (used by GRT sessions):
- Models: `Questionnaire`, `Question`, `QuestionChoice`
- `QuestionType`: TEXT, YES_OR_NO, MULTIPLE_CHOICE, SINGLE_CHOICE, IMAGE; `QuestionnaireAuditType`: PRE_AUDIT, POST_AUDIT
- Entry point: `components/masters/QuestionnairePage.tsx`; API: `app/api/questionnaires/`

### Member Individual
Post-indexation, pre-disbursement per-client data collection. BM fills one record per
loan, center-wise, right after Loan Indexation and before AM Level-2 approval. Three
per-loan tabs plus a separate center-wide GRT flow:
- Model: `MemberIndividual` (one per `loanId`) — Cash Flow (8 expense fields), Loan Appraisal
  (review + product change via `/api/disbursements/[loanId]/update-product`, allowed for
  BRANCH_MANAGER too), House Hold Visit (photo + GPS, validated against
  `Center.latitude/longitude` within `HOUSEHOLD_VISIT_CENTER_RADIUS_METERS` (500m) from `app/lib/location-utils.ts`)
- Model: `MemberIndividualPhoto` — House Hold Visit photos only (one mandatory in-range + optional extras)
- Completion of these 3 tabs is derived from their `*CompletedAt` columns (all non-null = complete)
- Photo storage: `app/lib/storage/member-individual-storage.ts`

**GRT is filled center-wide, but coverage is tracked per loan** — it's a `GrtSession`: BM
selects a subset of the center's *current pending-disbursement loans* (sourced from the same
roster as Member Individual, not a raw client list), picks a Questionnaire, answers it once for
the whole group, and uploads center-wise photos. A center can have multiple sessions across
different dates. `GrtSessionClient` is keyed by `loanId` (not just `clientId`) — a renewal/new
loan for the same client always needs its own separate GRT session; a prior loan's completed
session never satisfies a different loan cycle.
- Models: `GrtSession`, `GrtSessionClient` (selected members, keyed by `loanId`; `clientId`
  denormalized for display only), `GrtSessionAnswer`, `GrtSessionPhoto` (optionally tied to an
  IMAGE-type question)
- Entry point: `components/loan-module/GrtSessionsClient.tsx` (list + create per center) /
  `GrtSessionDetailPage.tsx` (fill); API: `app/api/grt-sessions/`
- Photo storage: `app/lib/storage/grt-session-storage.ts`

**Hard gate**: `app/lib/member-individual-gate.ts` (`findIncompleteMemberIndividualLoanIds`) is
the single source of truth — a loan is cleared only when its `MemberIndividual` 3 tabs are
complete AND that specific loan is in a completed `GrtSession`. Enforced at AM Level-2 approval
(`app/api/disbursements/level2-action/route.ts`) and, defense-in-depth, at BM final disbursement
(`app/api/disbursements/bm-disburse/route.ts`).
- Entry point: `components/loan-module/MemberIndividualClient.tsx` (roster, with a
  Members / GRT Sessions tab toggle) / `MemberIndividualDetailPage.tsx` (3-tab fill);
  API: `app/api/member-individual/`

### Inter-branch Transfers
- Model: `InterBranchTransfer` — cross-branch cash/bank settlement with paired vouchers
- `InterBranchTransferMode`: CASH or BANK
- `InterBranchTransferStatus`: POSTED, REVERSED, CANCELLED
- Component: `components/daily-monitoring/InterBranchTransferClient.tsx`

### Denomination Entry
- Model: `DenominationEntry` — daily branch cash count by note denomination (₹500–₹1 + UPI)
- Unique constraint: `branchId + entryDate`; auto-calculates total
- Component: `components/daily-monitoring/`

### Payroll & Attendance
- Models: `Attendance`, `LeaveType`, `EmployeeLeaveBalance`, `SalaryComponent`, `EmployeeSalaryMaster`, `SalaryPayRecord`, `SalaryPayLineItem`
- `AttendanceStatus`: PRESENT, ABSENT, HALF_DAY, FULL_DAY, HOLIDAY
- Component: `components/hr/attendance/`, `components/hr/payroll/`, `components/hr/leave/`

### Insurance Records
- Model: `InsuranceRecord` — policy tracking with coverage, premium, nominee, claim status, PDF
- `policyType`: CREDIT_LIFE, HEALTH, PERSONAL_ACCIDENT, GROUP
- Storage helper: `app/lib/storage/insurance-storage.ts`

### Economic Activity Classification
- Models: `EconomicActivityType`, `EconomicActivity`
- Replaces legacy `occupation` / `spouseOccupation` string fields on Client/CoApplicant
- Tracked for: client, spouse, co-applicant

### Enrollment Validation Config
- Model: `EnrollmentValidationConfig` — per-field required/optional toggles across enrollment pages
- Fields: page, fieldKey, fieldName, isRequired, isAlwaysRequired (lock prevents toggle)
- Service: `app/lib/services/enrollment-validation.service.ts`
- Hook: `hooks/useEnrollmentValidation.ts`

### Brand Config
- Model: `BrandConfig` (singleton) — admin-controlled UI theming
- Fields: primaryColor, sidebarBg, sidebarText, navBg, pageBg, fontSizeBase, etc.
- Component: `components/settings/BrandSettingsClient.tsx`

### Chart of Accounts (Account Groups & Ledgers)
- Models: `AccountGroup` (self-referencing hierarchy — `parentGroupId` references the parent's `groupId`, not its `id`), `AccountLedger` (belongs to one `AccountGroup` via `groupId`)
- `AccountGroup.groupName` uniqueness is scoped to `parentGroupId` (`@@unique([groupName, parentGroupId])`), not global — the same name is allowed under two different parents, but not twice under the same parent; two primary/root groups (`parentGroupId = null`) share that scope too, so root group names must also be unique among themselves. Enforced both by the DB constraint and an app-level check in POST/PUT (Postgres treats `NULL` as distinct in unique constraints, so the null/root case needs the app-level check)
- `AccountGroup` deletion is blocked if it has sub-groups or any linked `AccountLedger` rows (`_count.subGroups` / `_count.ledgers`)
- `AccountLedger.allowAccessTo` is a `String[]` (`H.O` / `B.O` only — `R.O` was removed); a ledger can be flagged for both offices at once
- `AccountLedger` deletion is blocked if it has any postings (`financialTransactions` + `creditFinancialTransactions` > 0)
- Once an `AccountLedger` has recorded transactions, editing is restricted to `ledgerName` only — `groupId`/`allowAccessTo` become immutable (enforced in the API and disabled in the UI)
- Components: `components/accounts/AccountsGroupPage.tsx` / `AccountsGroupTable.tsx` / `AccountsGroupForm.tsx` (group), `components/accounts/AccountsLedgerPage.tsx` / `AccountsLedgerTable.tsx` / `AccountsLedgerForm.tsx` (ledger)
- API: `app/api/accounts/groups/`, `app/api/accounts/ledgers/`

GL ledger constants (IDs, names, groups) live in `app/lib/constants/ledgers.ts` — read that file directly rather than duplicating it here.

---

Test files are co-located with their source under `app/lib/` (e.g. `branch-financial-day.test.ts`, `foreclosure-workflow.test.ts`) — `npm run test` runs them all.

---

## Do's and Don'ts

### DO
- ✅ Always use `prisma.$transaction()` for related multi-step DB writes
- ✅ Use `withRole` / `withAuth` wrappers on every API route
- ✅ Scope all DB queries to `branchId` for multi-tenancy
- ✅ Use `errorResponse` / `successResponse` — never raw `Response.json()`
- ✅ Use `apiClient` for all frontend HTTP calls
- ✅ Use `usePermission()` for UI gating — never hardcode `user.role === 'ADMIN'`
- ✅ Use `React.Fragment key={id}` (not `<>`) when mapping multiple sibling elements
- ✅ Run `prisma generate` after any schema change (stop dev server first on Windows)
- ✅ Validate all external input with Zod before touching the DB
- ✅ Use IST-aware date helpers (`getKolkataCalendarYmd`) for business dates — never `new Date().toLocaleDateString()`

### DON'T
- ❌ Don't use `prisma.migrate dev` — the shadow DB has a known drift issue; use `prisma db push`
- ❌ Don't write logic in `app/dashboard/*/page.tsx` — those are thin wrappers only
- ❌ Don't use bare `<>` fragments inside `.map()` — always use keyed `React.Fragment`
- ❌ Don't call raw `fetch()` from components — use `apiClient`
- ❌ Don't store sensitive data outside the Zustand `authStore` or `tokenStorage`
- ❌ Don't skip Zod validation on POST/PUT/PATCH routes
- ❌ Don't auto-calculate gold `goldTakenValue` from price master — BM enters it manually
- ❌ Don't commit `.env` — it contains live DB credentials and JWT secrets
- ❌ Don't create partial DB commits — wrap multi-step writes in `$transaction()`
- ❌ Don't use `Date.now()` for IST business dates — use the branch working day helpers

---

## Claude Instructions

- **Before editing any file:** Read the relevant agent file in `.claude/agents/` to confirm ownership and patterns
- **Before writing new code:** Check `.claude/skills/` for an existing template that matches the task
- **Never re-read files already in context** — reference line numbers from the current session
- **Use skill templates** instead of writing boilerplate from scratch (API routes, DB queries, forms)
- **After completing a task:** Summarize in 2 lines max — what changed and what to do next
- **Always check agent ownership** before editing files across domain boundaries
- **Scope all DB queries to branchId** — this is the multi-tenancy boundary, never skip it
