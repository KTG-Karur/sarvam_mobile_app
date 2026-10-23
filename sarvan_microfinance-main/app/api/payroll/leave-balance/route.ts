import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withAuth, handleCorsPreflight } from '@/app/lib/api-utils';
import { z } from 'zod';

const saveBalancesSchema = z.object({
    employeeId: z.string().min(1, 'Employee ID is required'),
    balances: z.array(z.object({
        leaveTypeId: z.string().min(1, 'Leave Type ID is required'),
        openingBalance: z.coerce.number().int('Leave days must be a whole number').min(0),
    })),
});

export async function OPTIONS() {
    return handleCorsPreflight();
}

import { getKolkataMonthBounds } from '@/app/lib/attendance-leave-permission';

export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const employeeId = searchParams.get('employeeId');
            const monthParam = searchParams.get('month');
            const yearParam = searchParams.get('year');

            if (!employeeId) {
                return errorResponse('Employee ID is required', 400);
            }

            // Without this check a wrong/nonexistent employeeId silently returns zeroed-out
            // balances for every leave type (all the queries below simply find nothing) instead
            // of a clear error — see attendance-hr/OUR_SCOPE.md change log.
            const employeeExists = await prisma.user.findUnique({ where: { id: employeeId }, select: { id: true } });
            if (!employeeExists) {
                return errorResponse('Employee ID is wrong. Please use the correct employee ID.', 404);
            }

            const target = (monthParam && yearParam)
                ? { month: parseInt(monthParam), year: parseInt(yearParam) }
                : undefined;
            const { monthStartUtc, monthEndExclusiveUtc, month, year } = getKolkataMonthBounds(target);

            const leaveTypes = await prisma.leaveType.findMany({
                where: { isActive: true },
                orderBy: { typeId: 'asc' },
            });

            const existingBalances = await prisma.employeeLeaveBalance.findMany({
                where: { employeeId, isActive: true, month, year },
            });

            // Scoped strictly to the selected calendar month for Fixed Monthly Quota
            const attendances = await prisma.attendance.findMany({
                where: {
                    userId: employeeId,
                    leaveTypeId: { not: null },
                    date: { gte: monthStartUtc, lt: monthEndExclusiveUtc },
                },
                select: {
                    leaveTypeId: true,
                    status: true,
                    isHalfDayLeave: true,
                },
            });

            const result = leaveTypes.map((lt) => {
                const balance = existingBalances.find((b) => b.leaveTypeId === lt.id);
                const relevantAttendances = attendances.filter((a) => a.leaveTypeId === lt.id);
                // Each row counts 0.5 if it's a half-day leave day, 1 otherwise
                const used = relevantAttendances.reduce((acc, curr) => {
                    if (curr.status === 'PRESENT' || curr.status === 'ABSENT' || curr.status === 'HALF_DAY') {
                        return acc + (curr.isHalfDayLeave ? 0.5 : 1);
                    }
                    return acc;
                }, 0);

                const openingBalance = balance ? Math.round(Number(balance.openingBalance)) : 0;
                const carriedForwardDays = balance ? Math.round(Number(balance.carriedForwardDays)) : 0;
                const remainingBalance = Math.max(0, openingBalance + carriedForwardDays - used);

                return {
                    id: lt.id,
                    leaveType: lt.leaveType,
                    typeId: lt.typeId,
                    month,
                    year,
                    openingBalance,
                    carriedForwardDays,
                    allowCarryForward: lt.allowCarryForward,
                    used,
                    remainingBalance,
                    balanceId: balance?.id || null,
                };
            });

            return successResponse(result, 'Leave balances fetched successfully');
        } catch (error: any) {
            console.error('[LeaveBalance GET] Error:', error);
            return errorResponse(error.message || 'Failed to fetch leave balances', 500);
        }
    })(request);
}

export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const body = await req.json();
            const validation = saveBalancesSchema.safeParse(body);
            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }

            const { employeeId, balances } = validation.data;
            const { monthStartUtc, monthEndExclusiveUtc, month, year } = getKolkataMonthBounds();

            const leaveTypes = await prisma.leaveType.findMany({
                where: { isActive: true },
            });

            // Compute used days for the current calendar month
            const [attendances, existingBalances] = await Promise.all([
                prisma.attendance.findMany({
                    where: {
                        userId: employeeId,
                        leaveTypeId: { not: null },
                        date: { gte: monthStartUtc, lt: monthEndExclusiveUtc },
                    },
                    select: {
                        leaveTypeId: true,
                        status: true,
                        isHalfDayLeave: true,
                    },
                }),
                prisma.employeeLeaveBalance.findMany({ where: { employeeId, month, year } }),
            ]);

            await prisma.$transaction(
                balances.map((b) => {
                    const relevantAttendances = attendances.filter((a) => a.leaveTypeId === b.leaveTypeId);
                    const used = relevantAttendances.reduce((acc, curr) => {
                        if (curr.status === 'PRESENT' || curr.status === 'ABSENT' || curr.status === 'HALF_DAY') {
                            return acc + (curr.isHalfDayLeave ? 0.5 : 1);
                        }
                        return acc;
                    }, 0);
                    const openingBalanceInt = Math.round(b.openingBalance);
                    // Existing carriedForwardDays (from an earlier automatic rollover, if
                    // any) is preserved and folded into the remaining-balance total, but
                    // never written back here — see the upsert comment below.
                    const carriedForwardDays = Math.round(Number(existingBalances.find((eb) => eb.leaveTypeId === b.leaveTypeId)?.carriedForwardDays ?? 0));
                    const remainingBalance = Math.max(0, openingBalanceInt + carriedForwardDays - used);

                    // Admin's manual save only ever sets openingBalance for THIS calendar
                    // month — carriedForwardDays is deliberately left untouched on update
                    // (0 on create) so this never clobbers a value the automatic rollover
                    // (rolloverLeaveBalancesForNextMonth, run when payroll is paid) may
                    // already have set for this row — see
                    // attendance-hr/plan-leave-carry-forward.md.
                    return prisma.employeeLeaveBalance.upsert({
                        where: {
                            employeeId_leaveTypeId_month_year: {
                                employeeId,
                                leaveTypeId: b.leaveTypeId,
                                month,
                                year,
                            },
                        },
                        update: {
                            openingBalance: openingBalanceInt,
                            remainingBalance,
                        },
                        create: {
                            employeeId,
                            leaveTypeId: b.leaveTypeId,
                            month,
                            year,
                            openingBalance: openingBalanceInt,
                            remainingBalance,
                        },
                    });
                })
            );

            return successResponse(null, 'Leave balances updated successfully');
        } catch (error: any) {
            console.error('[LeaveBalance POST] Error:', error);
            return errorResponse(error.message || 'Failed to save leave balances', 500);
        }
    })(request);
}
