# Loan Agent

## Role
Owns the entire loan lifecycle — from application through disbursement, repayment schedule, collections, foreclosure, and GL posting. The most complex domain in the system.

## Responsibilities
- Loan application creation and status management
- Loan indexation (batching loans for processing)
- 2-level disbursement approval workflow
- BM final disbursement (schedule generation + GL entry)
- Payment schedule calculation (flat rate and reducing balance)
- Collection recording, approval, and GL sync
- Foreclosure and savings refund workflows
- Gold loan collateral management at disbursement

## Files Owned
```
app/api/loans/**                                    # Loan CRUD, schedule, client-loans
app/api/loan-indexes/**                             # Index batch management
app/api/disbursements/**                            # All disbursement workflow endpoints
app/api/collections/**                              # Collection, bulk, foreclosure
app/api/foreclosures/**                             # Foreclosure approval
app/api/savings/**                                  # Savings summary, refund
app/api/gold-transactions/**                        # Gold return workflow
app/lib/services/loan.service.ts                   # LoanService: create, schedule, frequency
app/lib/schedule/                                   # Schedule generation logic
app/lib/collections/                               # Demand calculation
app/lib/loan-frequency.ts                          # Frequency helpers
app/lib/loan-transaction-lines.ts                  # Transaction line breakup
app/lib/eod-disbursement-gates.ts                  # EOD disbursement gate checks
app/lib/eod-collection-gates.ts                    # EOD collection gate checks
components/loan-module/                            # UI: application, disbursement, audit, indexation
components/collections/                            # UI: demand, foreclosure, bulk collection
```

## Key Workflows

### Loan number generation
Format: `LN` + 2-digit IST year + 6-digit sequential
Example: `LN26000001`

### Disbursement status flow
```
PENDING_LEVEL1 → APPROVED_LEVEL1 → PENDING_LEVEL2 → APPROVED_LEVEL2 → DISBURSED
```

### Schedule generation (in bm-disburse route)
- BM provides `firstDueDate`
- System generates `LoanSchedule` records from that date
- Frequencies: daily (skip Sundays), weekly, forthnight, monthly
- Methods: FLAT (equal installments) or REDUCING (product template-based)
- Advance savings `advanceSavingsAmount` added to each installment's `savingsDue`

### Gold loan disbursement
- BM manually enters: `karatType`, `gramCount`, `goldTakenValue`, `cashGiven`
- NO link to gold price master at disbursement — values are manual
- Creates `GoldLoanDetail` + `GoldTransaction(type=TAKE, status=APPROVED)`
- Gold return: BM initiates → AM approves → `GoldTransaction(type=GIVE)`

### Collection approval
- FDO creates `LoanTransaction(status=PENDING)`
- AM/BM approves → `status=APPROVED`
- On approval: `LoanSchedule` updated (principalPaid, interestPaid, status)
- GL sync: `FinancialTransaction` created if `isGlSynced=false`

## Patterns

### Create loan (uses loanService)
```typescript
import { loanService } from '@/app/lib/services/loan.service';
const result = await loanService.createLoanApplication(data, user.userId);
if (!result.success) return errorResponse(result.error, 400);
```

### Gold loan detail (at disbursement — all manual, no price master link)
```typescript
await tx.goldLoanDetail.create({
  data: { loanId, karatType, gramCount, goldTakenValue, cashGiven }
});
await tx.goldTransaction.create({
  data: { loanId, type: 'TAKE', gramCount, goldValue: goldTakenValue, status: 'APPROVED', initiatedById: user.userId, approvedById: user.userId, approvedAt: new Date() }
});
```

### Schedule generation (standard flat rate)
```typescript
// See app/api/disbursements/bm-disburse/route.ts:generateScheduleWithHolidaySkip()
const scheduleItems = generateScheduleWithHolidaySkip(loanData, productData, firstDueDate, templates, frequency, advanceSavingsAmount);
await tx.loanSchedule.createMany({ data: scheduleItems });
```

## Common Tasks
- Add new loan status → extend `DisbursementStatus` enum in schema, add migration
- Change schedule logic → edit `app/api/disbursements/bm-disburse/route.ts:generateScheduleWithHolidaySkip()`
- Add collection type → extend `LoanTransactionType` enum
- Debug missed payment → check `LoanSchedule.status`, `LoanTransactionLine` for allocations
- Gold return approval → `PATCH /api/gold-transactions/[id]/approve`
