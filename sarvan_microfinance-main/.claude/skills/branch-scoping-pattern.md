# Skill: Branch Scoping & Multi-Tenancy Pattern

## What It Does
Ensures all DB queries, API responses, and UI data are correctly scoped to the active branch. This is the primary multi-tenancy boundary in the system.

## When To Use
Every DB query in an API route or server action that returns records belonging to branches.

## Branch Context Sources

### In API routes (from withAuth / withRole)
```typescript
export async function GET(request: NextRequest) {
  return withAuth(async (req, user) => {
    const { userId, branchId, isHeadOffice } = user;
    // branchId is the active branch from JWT + session
  })(request);
}
```

### In frontend (from branchStorage)
```typescript
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';

const activeBranch = branchStorage.getActiveBranch();
const storedUser = tokenStorage.getUser();
const branchId = activeBranch?.id || storedUser?.branchId;
```

### X-Branch-Id header (injected automatically by apiClient)
```typescript
// apiClient.ts adds this header on every request:
headers['X-Branch-Id'] = activeBranch.id;
// getAuthenticatedUser() in api-utils.ts reads it:
// X-Branch-Id header > active-branch cookie > JWT branchId
```

## Scoping Patterns

### Basic query scope
```typescript
// Always add branchId to where clause
const loans = await prisma.loan.findMany({
  where: { branchId: user.branchId, isActive: true },
});
```

### Head Office (HO) sees all branches
```typescript
// HO admins can see across branches
const where = user.isHeadOffice
  ? { isActive: true }                         // HO: all branches
  : { branchId: user.branchId, isActive: true }; // Others: own branch only

const loans = await prisma.loan.findMany({ where });
```

### Area Manager sees assigned branches
```typescript
// AM can see up to 4 assigned branches
const amBranches = await prisma.areaManagerBranch.findMany({
  where: { userId: user.userId, isActive: true },
  select: { branchId: true },
});
const branchIds = amBranches.map(b => b.branchId);

const where = user.role === 'AREA_MANAGER'
  ? { branchId: { in: branchIds } }
  : { branchId: user.branchId };
```

### Optional branchId filter from query param (admin panels)
```typescript
const paramBranchId = searchParams.get('branchId');
const where = {
  // Allow explicit branchId override for HO; fallback to user's branch
  branchId: (user.isHeadOffice && paramBranchId) ? paramBranchId : user.branchId,
};
```

### Always include branchId in writes
```typescript
await prisma.loan.create({
  data: {
    ...loanData,
    branchId: user.branchId!,     // required — scope to active branch
    centerId,                      // center implicitly scopes to branch too
    createdById: user.userId,
  },
});
```

## Working Day Validation (required for all financial operations)

```typescript
import { getBranchWorkingDayWindow, isInstantWithinWindow } from '@/app/lib/branch-working-day-guard';
import { assertBranchNotLocked } from '@/app/lib/branch-lock';

// 1. Check branch is not locked (EOD in progress)
const lockResponse = await assertBranchNotLocked(branchId);
if (lockResponse) return lockResponse; // returns 423 if locked

// 2. Check current time is within working window
const workingDay = await getBranchWorkingDayWindow({ branchId });
if (!isInstantWithinWindow(new Date(), workingDay)) {
  return errorResponse(
    `Operation must be within branch working day (${workingDay.workingDateYmd})`,
    400
  );
}
```

## IST Date for Business Dates

```typescript
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';

// CORRECT — always IST
const todayIST = getKolkataCalendarYmd(new Date()); // "2026-06-03"

// WRONG — server may be in UTC or different TZ
const today = new Date().toISOString().split('T')[0]; // can be yesterday in IST
```

## Rules
- Every query that touches branch-owned data MUST have `branchId` in `where`
- Only `isHeadOffice === true` users skip branch scoping
- Financial operations MUST validate working window before proceeding
- Never trust `branchId` from request body — always use `user.branchId` from JWT
- AM branch access validated via `AreaManagerBranch` table, not just `user.branchId`
