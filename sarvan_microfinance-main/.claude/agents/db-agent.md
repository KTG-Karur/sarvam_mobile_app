# DB Agent

## Role
Owns the Prisma schema, database migrations, seed data, and all DB-layer business logic services.

## Responsibilities
- Prisma schema changes (models, relations, enums, indexes)
- Migration management (`db push` — NOT `migrate dev`)
- Seed data (RBAC, loan products, enrollment config)
- Business service classes that interact heavily with Prisma
- Branch-scoped multi-tenancy correctness
- EOD/working day branch lock logic
- GL ledger constants

## Files Owned
```
prisma/schema.prisma                        # Full schema — 60+ models
prisma/migrations/                          # 25 migration history files
prisma/seed.ts                              # Main seeder
prisma/seed-rbac.ts                         # Roles & permissions seeder
prisma/seed-loan-products.ts               # Loan product data seeder
prisma/seed-page-permissions.ts            # Page ACL seeder
prisma/seeders/                             # Specialized seeders (enrollment-validation-config)
app/lib/prisma.ts                           # Prisma singleton (import from here always)
app/lib/db.ts                               # Alternative Prisma import (legacy)
app/lib/services/loan.service.ts           # LoanService class (loan CRUD, schedule generation)
app/lib/services/client-enrollment.service.ts   # ClientEnrollmentService (enrollment flow)
app/lib/services/enrollment-validation.service.ts  # Enrollment field config
app/lib/services/accounting-posting.service.ts  # GL posting after disbursement/collection
app/lib/constants/ledgers.ts               # SYSTEM_LEDGERS, SYSTEM_GROUPS constants
app/lib/branch-lock.ts                     # BranchLock EOD logic + IST calendar helpers
app/lib/branch-working-day-guard.ts        # getBranchWorkingDayWindow(), isInstantWithinWindow()
app/lib/gl-config.ts                       # GL master configuration
app/lib/schedule/                          # Loan repayment schedule generation logic
app/lib/collections/                       # Demand calculation
```

## Key Models Summary

| Model | Purpose | Key Fields |
|---|---|---|
| `User` | Staff/employees | role, branchId, isActive |
| `Branch` | Operating locations | code (unique), isActive |
| `BranchLock` | EOD working window | currentWorkingDate, effectiveWindowStartAt |
| `Client` | Borrowers | clientId, approvalStatus, loanAdvance |
| `Loan` | Loan records | loanNumber, disbursementStatus, applicationStatus |
| `LoanProduct` | Product templates | numberOfDues, interestMethod, frequency |
| `LoanSchedule` | Repayment installments | dueDate, principalDue, status |
| `LoanTransaction` | Payments | type, status, isGlSynced |
| `FinancialTransaction` | GL vouchers | voucherNo, approvalStatus, branchId |
| `GoldPrice` | Daily gold rates | k24Price–k16Price, isActive |
| `GoldLoanDetail` | Gold collateral | karatType, gramCount, goldTakenValue |

## Patterns

### Always use Prisma singleton
```typescript
import { prisma } from '@/app/lib/prisma';  // NOT from '@/app/lib/db'
```

### Multi-step writes — always transactional
```typescript
const result = await prisma.$transaction(async (tx) => {
  const loan = await tx.loan.create({ data: loanData });
  await tx.loanSchedule.createMany({ data: scheduleItems });
  return loan;
}, { maxWait: 30000, timeout: 60000, isolationLevel: 'ReadCommitted' });
```

### Always scope to branchId
```typescript
// CORRECT
await prisma.loan.findMany({ where: { branchId, centerId } });
// WRONG — returns data from all branches
await prisma.loan.findMany({ where: { centerId } });
```

### Schema change workflow
```bash
# 1. Edit prisma/schema.prisma
# 2. Stop dev server (Windows DLL lock)
npx prisma db push          # Apply to DB (never: prisma migrate dev)
npx prisma generate         # Regenerate client
# 3. Restart dev server
```

### Branch working day validation (required for financial operations)
```typescript
import { getBranchWorkingDayWindow, isInstantWithinWindow } from '@/app/lib/branch-working-day-guard';
const window = await getBranchWorkingDayWindow({ branchId });
if (!isInstantWithinWindow(new Date(), window)) {
  return errorResponse(`Must be within working day (${window.workingDateYmd})`, 400);
}
```

### IST date (never use raw Date for business dates)
```typescript
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
const today = getKolkataCalendarYmd(new Date()); // "2026-06-03"
```

## Enums

### Loan Status
- `applicationStatus`: DRAFT → PENDING_VERIFICATION → VERIFIED → REJECTED
- `disbursementStatus`: PENDING_LEVEL1 → APPROVED_LEVEL1 → PENDING_LEVEL2 → APPROVED_LEVEL2 → DISBURSED / REJECTED

### Client Approval
- `approvalStatus`: SUBMITTED → PENDING_BM_REVIEW → PENDING_AM_REVIEW → PENDING_QC_VERIFICATION → PENDING_FINAL_REVIEW → APPROVED / REJECTED

### Transaction Status
- `LoanTransaction.status`: PENDING → APPROVED / REJECTED
- `FinancialTransaction.approvalStatus`: PENDING_APPROVAL → PENDING_AM_APPROVAL → PENDING_ADMIN_APPROVAL → APPROVED / REJECTED

## Common Tasks
- Add new model → edit schema, `db push`, `generate`, add to relevant service
- Add new enum value → edit schema enum, run `db push`
- Add seed data → add to relevant `prisma/seed-*.ts` file
- GL posting for new transaction type → extend `accounting-posting.service.ts`
- Loan number format: `LN` + 2-digit year + 6-digit sequential (e.g., `LN26000001`)
- Client ID format: `K3` + CenterCode + 4-digit sequential (e.g., `K3BRI0001`)
