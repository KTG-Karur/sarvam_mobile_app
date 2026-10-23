# Loan Product Architecture — Redesign Summary

## Status: ✅ IMPLEMENTED

---

## What Was Done

### 1. Schema Redesign (Prisma)

**Removed from `LoanProduct`:**
- `scheduleOption` — was conflating product setup with schedule input method
- `fromDue` / `tillDue` — loan-instance dates that don't belong on a product template
- `principal` / `interest` — redundant per-installment fields that caused confusion
- `loginStatus` → renamed to `status` for clarity

**Added to `LoanProduct`:**
- `interestMethod` — `FLAT` or `REDUCING` (default: `FLAT`)
- `status` — replaces `loginStatus`
- `scheduleTemplates` — relation to `ProductScheduleTemplate`

**New Model — `ProductScheduleTemplate`:**
```
model ProductScheduleTemplate {
  id              String      @id @default(cuid())
  productId       String
  installmentNo   Int
  principalAmount Decimal     @db.Decimal(15, 2)
  interestAmount  Decimal     @db.Decimal(15, 2)
  createdAt       DateTime    @default(now())
  product         LoanProduct @relation(...)
  @@unique([productId, installmentNo])
}
```

This enables **reducing balance loans** where each installment has different principal/interest amounts (imported from Excel).

---

### 2. Products API (`/api/products`)

- **GET** — Fetches products with optional `includeTemplates=true` and single product fetch via `productId` query param
- **POST** — Creates product with optional `scheduleTemplates` array; auto-calculates interest for FLAT method
- **PUT** — Updates product; replaces schedule templates atomically
- **DELETE** — Soft delete with active loan check
- **Role Guard** — `ADMIN` and `BRANCH_MANAGER` only for mutations
- **Backward compatibility** — Response includes `loginStatus` and `totalDues` aliases

---

### 3. Loan Product Form (Frontend)

**Removed:**
- From Due / Till Due date pickers
- Manual Principal / Interest inputs
- Non-functional "Paste Schedule" radio button

**Added:**
- **Interest Method** dropdown (Flat Rate / Reducing Balance)
- **Auto-Computed Summary** card showing totals and per-installment breakdowns
- **Paste Schedule** feature that actually works:
  - Paste from Excel (tab-separated) or CSV (comma-separated)
  - Parses `dueno, principal, interest` columns
  - Shows preview table with totals
  - Auto-fills numberOfDues and interestAmount from parsed data
- **Download Template** button for schedule format

---

### 4. Schedule Generation (Loan Service)

**`calculateSchedule()`** now supports:
- **FLAT method**: Equal principal and interest per installment
- **REDUCING method**: Uses `ProductScheduleTemplate` rows for per-installment amounts

**New: `generateAndPersistSchedule()`**:
- Called at **disbursement time** (not loan creation)
- Fetches product with schedule templates
- Generates schedule items with proper due dates
- Persists all `LoanSchedule` rows to the database
- Handles re-disbursement by deleting existing schedule first

---

### 5. Disbursement (Level 2 Action)

Updated to:
- Fetch `scheduleTemplates` alongside product
- Pass templates to `calculateSchedule()` for reducing balance loans
- Generate proper per-installment breakdowns at disbursement

---

### 6. Loan Application Form

Fixed:
- **Interest rate** now comes from product's `interestRate` field (was incorrectly calculated as `interest/loanAmount*100`)
- **Frequency** auto-set from product with proper mapping
- **Amount and Interest Rate** become **read-only** when product is selected (prevents manual overrides)

---

### 7. Preview Dialog

Fixed:
- Shows **real data** from API (was using mock/hardcoded data)
- Displays interest method, computed summary, and schedule template table
- Collapsible schedule view for reducing balance products

---

## How the Paste Schedule Works

The Excel file (`docs/product_schedule.xlsx`) contains a **reducing balance schedule**:

| DueNo | Principal | Interest | Pribal  | Intbal |
|-------|-----------|----------|---------|--------|
| 1     | 804       | 256      | 31,196  | 4,544  |
| 2     | 810       | 250      | 30,386  | 4,294  |
| ...   | ...       | ...      | ...     | ...    |
| 34    | 1,020     | 20       | 1,026   | 14     |

- **Principal increases** each installment (more goes to principal as balance shrinks)
- **Interest decreases** each installment (calculated on reducing balance)
- **Total per installment** stays roughly constant (~₹1,060 = EMI-like)

When pasted into the form:
1. Each row becomes a `ProductScheduleTemplate` record
2. `numberOfDues` auto-set to row count
3. `interestAmount` auto-calculated as sum of all interest columns
4. `interestMethod` auto-set to `REDUCING`
5. At disbursement, these exact principal/interest amounts are used per installment

---

## Migration

Run the manual migration SQL:
```bash
psql -d your_database -f prisma/migrations/manual_redesign_loan_product.sql
```

Or apply via Prisma:
```bash
npx prisma db push
```

---

## Architecture Principle: Product as Template, Loan as Instance

```
┌─────────────────────────────────────────────────────┐
│                  LOAN PRODUCT                        │
│  (Template — defines WHAT a loan looks like)         │
│                                                      │
│  • Fixed Amount    • Interest Rate (% p.a.)          │
│  • Frequency       • Number of Installments          │
│  • Interest Method (FLAT / REDUCING)                 │
│  • Schedule Templates (for REDUCING)                 │
│  • Fees (Insurance, Document Charges)                │
│                                                      │
│  ❌ NO dates, NO client info, NO instance data       │
└──────────────────────┬──────────────────────────────┘
                       │
                       │ 1:N
                       ▼
┌─────────────────────────────────────────────────────┐
│                     LOAN                             │
│  (Instance — a specific client's actual loan)        │
│                                                      │
│  • ClientId         • CenterId                       │
│  • Amount           • Interest Rate                  │
│  • Disbursement Date  • Status                       │
│  • Created by FDO   • Approved by BM/AM              │
│                                                      │
│  ✅ Has dates, client info, instance data             │
└──────────────────────┬──────────────────────────────┘
                       │
                       │ 1:N (generated at DISBURSEMENT)
                       ▼
┌─────────────────────────────────────────────────────┐
│                LOAN SCHEDULE                         │
│  (Fixed installments with due dates)                 │
│                                                      │
│  • InstallmentNo    • DueDate                        │
│  • PrincipalDue     • InterestDue                    │
│  • PrincipalPaid    • InterestPaid                   │
│  • Status (PENDING / PAID / OVERDUE)                 │
└─────────────────────────────────────────────────────┘
```
