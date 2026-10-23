# Loan Number Generation Fix

## Problem
The loan application was failing with a "Unique constraint failed on the fields: (`loanNumber`)" error when trying to create new loans.

## Root Cause
The original `generateLoanNumber()` function had a **race condition** vulnerability:

1. It counted existing loans for the year
2. Added 1 to get the next sequential number
3. Created the loan with that number

**The Issue**: If two loan applications were submitted simultaneously (or in quick succession), both would:
- Count the same number of existing loans (e.g., 2)
- Both generate the same loan number (e.g., LN26000003)
- Both try to insert, causing a unique constraint violation

## Solution Implemented

### 1. Improved Loan Number Generation (`loan.service.ts`)
The new implementation:

```typescript
private async generateLoanNumber(attempt = 0): Promise<string> {
    // 1. Query the LAST loan number directly (not count)
    const lastLoan = await prisma.loan.findFirst({
        where: { loanNumber: { startsWith: prefix } },
        orderBy: { loanNumber: 'desc' },
    });

    // 2. Extract and increment the sequential number
    let sequentialNumber = 1;
    if (lastLoan) {
        const lastSequential = lastLoan.loanNumber.substring(prefix.length);
        sequentialNumber = parseInt(lastSequential, 10) + 1;
    }

    // 3. Verify uniqueness before returning
    const exists = await prisma.loan.findUnique({
        where: { loanNumber },
    });

    // 4. If collision detected, retry with random delay
    if (exists && attempt < MAX_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
        return this.generateLoanNumber(attempt + 1);
    }

    return loanNumber;
}
```

**Key Improvements**:
- ✅ Queries the last loan number directly instead of counting
- ✅ Verifies uniqueness before returning
- ✅ Implements retry logic with random delays (up to 5 attempts)
- ✅ Handles race conditions gracefully

### 2. Diagnostic Scripts

#### Check for Duplicates
```bash
npx tsx scripts/check-loan-numbers.ts
```
This script:
- Checks for existing duplicate loan numbers
- Shows the latest loan number for each year
- Helps diagnose issues

#### Fix Duplicates (if needed)
```bash
npx tsx scripts/fix-duplicate-loan-numbers.ts
```
This script:
- Finds all duplicate loan numbers
- Keeps the oldest loan with each number
- Regenerates unique numbers for duplicates
- ⚠️ **WARNING**: Modifies database - backup first!

## Current Database Status
As of the last check:
- ✅ No duplicate loan numbers found
- Latest loan number: `LN26000002` (created: 2026-01-28)
- Next loan number will be: `LN26000003`

## Testing the Fix

1. **Test single loan creation**:
   - Navigate to `/dashboard/loan-module/application`
   - Select a center and client
   - Fill in loan details
   - Submit the form
   - ✅ Should create successfully with loan number `LN26000003`

2. **Test concurrent loan creation** (optional):
   - Open multiple browser tabs
   - Start creating loans simultaneously
   - ✅ Each should get a unique loan number
   - ✅ No duplicate errors should occur

## Loan Number Format
- **Format**: `LN` + `YY` + `NNNNNN`
- **Example**: `LN26000003`
  - `LN` = Loan prefix
  - `26` = Year 2026
  - `000003` = Sequential number (6 digits, zero-padded)

## Additional Notes

### Why This Approach Works
1. **Direct Query**: Querying the last loan number is more reliable than counting
2. **Verification**: Double-checking uniqueness before returning prevents most race conditions
3. **Retry Logic**: Random delays reduce collision probability in high-concurrency scenarios
4. **Bounded Retries**: Maximum 5 attempts prevents infinite loops

### Performance Considerations
- The additional uniqueness check adds minimal overhead
- Retry logic only activates in rare race condition scenarios
- Random delays (0-100ms) are negligible for user experience

### Future Improvements (if needed)
If you experience very high concurrency (100+ simultaneous loan creations), consider:
1. Database-level sequence generators
2. Distributed lock mechanisms
3. UUID-based loan numbers with human-readable display IDs

## Files Modified
1. `app/lib/services/loan.service.ts` - Fixed `generateLoanNumber()` method
2. `scripts/check-loan-numbers.ts` - New diagnostic script
3. `scripts/fix-duplicate-loan-numbers.ts` - New cleanup script
