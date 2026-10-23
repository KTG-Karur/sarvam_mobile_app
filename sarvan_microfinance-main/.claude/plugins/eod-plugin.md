# Plugin: EOD (End-of-Day) Process & Branch Lock

## Purpose
Controls the daily working window for each branch. Prevents transactions outside business hours, enforces business date (IST), and manages the EOD closing/opening cycle.

## Files
```
app/lib/branch-lock.ts                    # BranchLock logic, IST calendar helpers
app/lib/branch-working-day-guard.ts       # getBranchWorkingDayWindow(), isInstantWithinWindow()
app/lib/eod-working-date-policy.ts        # Working date policy rules
app/lib/eod-checklist-details.ts          # Checklist items required before EOD
app/lib/eod-collection-gates.ts           # Collection gates (blocks EOD if collections pending)
app/lib/eod-disbursement-gates.ts         # Disbursement gates (blocks EOD if disbursements pending)
app/api/eod-process/route.ts              # EOD execution endpoint
app/api/utilities/eod-checklist-details/route.ts  # Checklist status endpoint
app/api/branches/lock/route.ts            # Lock/unlock branch
app/api/branches/extend-lock/route.ts     # Manual override extension
```

## BranchLock Model Fields
```
currentWorkingDate          — Business date (IST YYYY-MM-DD)
defaultOpenMinutes          — Default open time (540 = 9:00 AM IST)
defaultCloseMinutes         — Default close time (1080 = 6:00 PM IST)
effectiveWindowStartAt      — Actual UTC timestamp when window opens
effectiveWindowEndAt        — Actual UTC timestamp when window closes
isManuallyExtended          — Override flag
manualOverrideUntil         — Extended close time
lastEodClosedAt             — When last EOD ran
```

## Working Day Validation (required before all financial transactions)
```typescript
import { getBranchWorkingDayWindow, isInstantWithinWindow } from '@/app/lib/branch-working-day-guard';
import { assertBranchNotLocked } from '@/app/lib/branch-lock';

// Step 1: Check EOD not in progress
const lockResponse = await assertBranchNotLocked(center.branchId);
if (lockResponse) return lockResponse; // HTTP 423 Locked

// Step 2: Check within working window
const workingDay = await getBranchWorkingDayWindow({ branchId: center.branchId });
if (!isInstantWithinWindow(new Date(), workingDay)) {
  return errorResponse(
    `Transaction must be within branch working day (${workingDay.workingDateYmd})`,
    400
  );
}
```

## IST Date Helpers
```typescript
import { getKolkataCalendarYmd, getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';

// Get today's date in IST
const todayIST = getKolkataCalendarYmd(new Date()); // "2026-06-03"

// Get UTC bounds for a given IST business date
const { dayStartUtc, dayEndUtc } = getUtcBoundsForBranchCalendarDay('2026-06-03', 'Asia/Kolkata');
```

## EOD Flow
1. Checklist validation: all gates must pass (no pending collections, disbursements)
2. Lock branch: `assertBranchNotLocked()` prevents concurrent EOD
3. Process EOD: reconcile GL, close working day
4. Advance `currentWorkingDate` to next business day
5. Set new `effectiveWindowStartAt`/`effectiveWindowEndAt` for next day

## Manual Override (emergency extension)
```
POST /api/branches/extend-lock
Body: { branchId, extendUntil, reason }
Sets: isManuallyExtended=true, manualOverrideUntil, manualOverrideReason, manualOverrideByUserId
```

## Usage Note
Every disbursement and collection route calls both `assertBranchNotLocked` and `isInstantWithinWindow` before processing. If either fails, the transaction is rejected. This is enforced in `bm-disburse/route.ts`, `collections/demand/route.ts`, etc.
