# Skill: Prisma Query Pattern

## What It Does
Standard patterns for Prisma DB queries in this project: singleton import, branch scoping, transactions, pagination, and error handling.

## When To Use
Any time you write a Prisma query in an API route, service, or server action.

## Patterns

### Always import from the singleton
```typescript
import { prisma } from '@/app/lib/prisma';  // correct
// NOT: import { PrismaClient } from '@prisma/client'
// NOT: import { prisma } from '@/app/lib/db'  (legacy, avoid)
```

### Always scope to branchId (multi-tenancy)
```typescript
// CORRECT — tenant-safe
const loans = await prisma.loan.findMany({
  where: { branchId: user.branchId, isActive: true },
});

// WRONG — leaks cross-branch data
const loans = await prisma.loan.findMany({ where: { isActive: true } });
```

### Multi-step writes — always use $transaction
```typescript
const result = await prisma.$transaction(async (tx) => {
  const parent = await tx.loan.create({ data: loanData });
  await tx.loanSchedule.createMany({
    data: scheduleItems.map(item => ({ ...item, loanId: parent.id })),
  });
  await tx.goldLoanDetail.create({ data: { ...goldData, loanId: parent.id } });
  return parent;
}, { maxWait: 30000, timeout: 60000, isolationLevel: 'ReadCommitted' });
```

### Pagination (consistent pattern across all list endpoints)
```typescript
const page = parseInt(searchParams.get('page') || '1');
const pageSize = parseInt(searchParams.get('pageSize') || '20');
const skip = (page - 1) * pageSize;

const [items, total] = await prisma.$transaction([
  prisma.model.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' } }),
  prisma.model.count({ where }),
]);

return successResponse({ items, total, page, pageSize });
```

### findUnique with 404 guard
```typescript
const item = await prisma.model.findUnique({ where: { id } });
if (!item) return errorResponse('Not found', 404);
```

### Batch creates (no transaction needed for createMany)
```typescript
await prisma.loanSchedule.createMany({
  data: scheduleItems,
  skipDuplicates: true,  // optional
});
```

### Delete existing + recreate (for re-generation)
```typescript
await tx.loanSchedule.deleteMany({ where: { loanId } });
await tx.loanSchedule.createMany({ data: newItems });
```

### Date range filter (ISO strings from query params)
```typescript
const where = {
  branchId: user.branchId,
  transactionDate: {
    gte: new Date(fromDate + 'T00:00:00.000Z'),
    lte: new Date(toDate + 'T23:59:59.999Z'),
  },
};
```

### Select specific fields (avoid over-fetching)
```typescript
const loan = await prisma.loan.findUnique({
  where: { id: loanId },
  select: { id: true, loanNumber: true, amount: true, clientId: true },
});
```

### Include relations selectively
```typescript
const loan = await prisma.loan.findUnique({
  where: { id },
  include: {
    client: { select: { firstName: true, lastName: true, clientId: true } },
    loanProduct: { select: { productName: true, numberOfDues: true } },
    loanSchedule: { where: { status: 'PENDING' }, orderBy: { installmentNo: 'asc' } },
  },
});
```

### Prisma error codes
```typescript
try {
  await prisma.model.create({ data });
} catch (error: any) {
  if (error.code === 'P2002') return errorResponse('Already exists', 409);       // unique constraint
  if (error.code === 'P2025') return errorResponse('Record not found', 404);      // not found
  if (error.code === 'P2003') return errorResponse('Foreign key violation', 400); // FK constraint
  throw error; // re-throw unexpected errors
}
```

### IST-aware date for business operations (never use raw new Date())
```typescript
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
const todayIST = getKolkataCalendarYmd(new Date()); // "2026-06-03"
```

## Naming Conventions
- Model names are PascalCase: `Loan`, `LoanSchedule`, `GoldTransaction`
- All models have `id` (cuid), `createdAt`, `updatedAt`
- Soft-delete pattern: `isActive: false` (not physical delete for most models)
- Branch scoping field: `branchId` (not `branch_id`)
