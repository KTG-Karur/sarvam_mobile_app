import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { parseRevertLocation, revertLocationColumns } from '@/app/lib/revert-location';
import { errorResponse, successResponse, withRole, handleCorsPreflight } from '@/app/lib/api-utils';
import {
    BRANCH_DEFAULT_CLOSE_MINUTES,
    BRANCH_DEFAULT_OPEN_MINUTES,
    BRANCH_LOCK_TIMEZONE,
    computeDefaultWindowForWorkingDate,
} from '@/app/lib/branch-lock';
import {
    addCalendarDaysToYmd,
    getBranchCalendarDayHalfOpenUtc,
    getBranchCalendarYmdForInstant,
    parseDenominationEntryDateUtc,
} from '@/app/lib/branch-financial-day';
import { hasBranchLockPolicyColumns } from '@/app/lib/branch-lock-policy-schema';
import { isSundayYmdInTimeZone } from '@/app/lib/eod-working-date-policy';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/utilities/eod-process/revert
 * "Reopen the day" — rolls BranchLock.currentWorkingDate back to the previous
 * working day. This is NOT a full rollback of everything that happened during
 * the close (no snapshot/audit table exists to make that safe) — it only
 * covers the common "closed EOD by mistake, nothing since" case, and is
 * blocked (in STRICT mode) if any collection/voucher/meeting/denomination
 * activity is already recorded on the current working date. Admin-only.
 *
 * `mode: 'CORRECTION'` skips that activity check — used only by the
 * multi-day "Revert to Date" cascade, which walks back through already-closed
 * days *on purpose* to reopen an older day for a correction. It does not
 * touch/delete that day's collections/vouchers/meetings — those stay as-is.
 * The denomination entry for each reopened day still has to be corrected and
 * resubmitted before EOD can be closed forward again through it — that check
 * lives in `closeEodForBranch` (Code 10 of the checklist) and is untouched
 * here, so this mode can't be used to skip past a real balance mismatch.
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const body = await req.json().catch(() => ({}));
            const branchId: string | undefined = body.branchId;
            const reason: string | undefined = body.reason;
            const mode: string = body.mode === 'CORRECTION' ? 'CORRECTION' : 'STRICT';

            if (!branchId) return errorResponse('Branch context is required', 400);
            if (!reason || !reason.trim()) return errorResponse('A reason is required to revert EOD', 400);
            // Location is mandatory for every revert.
            const parsedLocation = parseRevertLocation(body);
            if ('error' in parsedLocation) return errorResponse(parsedLocation.error, 400);
            const location = parsedLocation.location;

            const policyColumnsAvailable = await hasBranchLockPolicyColumns();
            const branchLock = policyColumnsAvailable
                ? await prisma.branchLock.findUnique({
                      where: { branchId },
                      select: {
                          currentWorkingDate: true,
                          timezone: true,
                          defaultOpenMinutes: true,
                          defaultCloseMinutes: true,
                      },
                  })
                : await prisma.branchLock.findUnique({
                      where: { branchId },
                      select: { currentWorkingDate: true },
                  });

            if (!branchLock) return errorResponse('Branch lock not found', 404);

            const timezone =
                policyColumnsAvailable && 'timezone' in branchLock && typeof branchLock.timezone === 'string' && branchLock.timezone.length > 0
                    ? branchLock.timezone
                    : BRANCH_LOCK_TIMEZONE;
            const openMinutes =
                policyColumnsAvailable && 'defaultOpenMinutes' in branchLock && typeof branchLock.defaultOpenMinutes === 'number'
                    ? branchLock.defaultOpenMinutes
                    : BRANCH_DEFAULT_OPEN_MINUTES;
            const closeMinutes =
                policyColumnsAvailable && 'defaultCloseMinutes' in branchLock && typeof branchLock.defaultCloseMinutes === 'number'
                    ? branchLock.defaultCloseMinutes
                    : BRANCH_DEFAULT_CLOSE_MINUTES;

            const currentWorkingDate = branchLock.currentWorkingDate;
            const currentYmd = getBranchCalendarYmdForInstant(currentWorkingDate, timezone);
            const { dayStartUtc, dayEndExclusiveUtc } = getBranchCalendarDayHalfOpenUtc(currentWorkingDate, timezone);

            // STRICT mode guard: reopening is only safe if nothing has happened yet on
            // the current working date — otherwise every EOD gate for that activity
            // would desync. CORRECTION mode intentionally skips this — it's walking
            // back through already-closed days on purpose, without touching their data.
            if (mode === 'STRICT') {
                const [txCount, finTxCount, meetingCount, denomCount] = await Promise.all([
                    prisma.loanTransaction.count({
                        where: { branchId, transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc } },
                    }),
                    prisma.financialTransaction.count({
                        where: { branchId, isActive: true, transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc } },
                    }),
                    prisma.collectionMeetingRecord.count({
                        where: { branchId, collectionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc } },
                    }),
                    prisma.denominationEntry.count({
                        where: { branchId, entryDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc } },
                    }),
                ]);

                if (txCount > 0 || finTxCount > 0 || meetingCount > 0 || denomCount > 0) {
                    return errorResponse(
                        `Cannot reopen — ${currentYmd} already has recorded activity (${txCount} collections, ${finTxCount} vouchers, ${meetingCount} meetings, ${denomCount} denomination entries). Revert/undo that activity first.`,
                        409
                    );
                }
            }

            // Walk back one calendar day at a time, skipping Sundays (mirror of the
            // forward Sunday-skip logic in app/api/utilities/eod-process/route.ts).
            let previousYmd = addCalendarDaysToYmd(currentYmd, -1);
            for (let i = 0; i < 14 && isSundayYmdInTimeZone(previousYmd, timezone); i += 1) {
                previousYmd = addCalendarDaysToYmd(previousYmd, -1);
            }

            const previousDate = parseDenominationEntryDateUtc(previousYmd);
            const newWindow = computeDefaultWindowForWorkingDate(previousDate, timezone, openMinutes, closeMinutes);

            // History row is written in the same transaction as the BranchLock
            // overwrite, before the prior state is lost — see EodRevertHistory in
            // schema.prisma. Without this, a revert leaves no persisted trace at all.
            // Uses the interactive form (not a plain array) so a concurrent-change
            // no-op (updateMany matching 0 rows) can abort the whole transaction
            // instead of leaving a phantom history row behind for a revert that
            // never actually happened.
            let concurrentChange = false;
            await prisma.$transaction(async (tx) => {
                const updateResult = policyColumnsAvailable
                    ? await tx.branchLock.updateMany({
                          where: { branchId, currentWorkingDate },
                          data: {
                              currentWorkingDate: previousDate,
                              lockTime: newWindow.end,
                              effectiveWindowStartAt: newWindow.start,
                              effectiveWindowEndAt: newWindow.end,
                              isManuallyExtended: false,
                              manualOverrideUntil: null,
                              manualOverrideReason: null,
                              manualOverrideByUserId: null,
                          },
                      })
                    : await tx.branchLock.updateMany({
                          where: { branchId, currentWorkingDate },
                          data: {
                              currentWorkingDate: previousDate,
                              lockTime: newWindow.end,
                          },
                      });

                if (updateResult.count === 0) {
                    concurrentChange = true;
                    return;
                }

                await tx.eodRevertHistory.create({
                    data: {
                        branchId,
                        fromWorkingDate: currentWorkingDate,
                        toWorkingDate: previousDate,
                        mode,
                        revertedById: user.userId,
                        revertReason: reason.trim(),
                        ...revertLocationColumns(location),
                    },
                });
            });

            if (concurrentChange) {
                return errorResponse('Working date changed concurrently. Refresh and try again.', 409);
            }

            console.log(
                `[EOD Revert:${mode}] Branch ${branchId} reopened by ${user.userId}: ${currentYmd} -> ${previousYmd}. Reason: ${reason.trim()}`
            );

            return successResponse(
                { previousWorkingDateYmd: previousYmd },
                `EOD reopened. Working date rolled back to ${previousYmd}.`
            );
        } catch (error) {
            console.error('[EOD Revert] POST Error:', error);
            return errorResponse('Failed to revert EOD', 500);
        }
    })(request);
}
