import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    errorResponse,
    successResponse,
    withAuth,
    handleCorsPreflight,
} from '@/app/lib/api-utils';
import { z } from 'zod';
import {
    getKolkataCalendarYmd,
    getUtcBoundsForBranchCalendarDay,
} from '@/app/lib/branch-lock';
import { deriveDayStatusFromHours } from '@/app/lib/attendance-config';
import { checkDayAttendanceAllowed } from '@/app/lib/attendance-schedule';
import { getApprovedLeaveForDay, formatHalfDayLeaveBlockedMessage } from '@/app/lib/attendance-leave-permission';
import { resolveEmployeeShiftConfig } from '@/app/lib/employee-shift';
import { recordPunchTrackingEvent } from '@/app/lib/hr-tracking';
import { checkPunchRadius } from '@/app/lib/punch-radius';

const deviceBiometricSchema = z.object({
    type: z.enum(['PUNCH_IN', 'PUNCH_OUT']),
    method: z.string().optional().default('DEVICE_BIOMETRIC'),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    batteryPercent: z.number().min(0).max(100).optional(),
    deviceId: z.string().optional(),
});

export async function OPTIONS() {
    return handleCorsPreflight();
}

// POST /api/auth/attendance/device-biometric — records a punch the user confirmed
// with the OS fingerprint / Face unlock (`local_auth`) instead of the
// face-recognition camera. The device check has already passed on-device; this
// endpoint owns the attendance decision (same idempotency rules as
// /api/auth/face/verify) and logs the method for audit. Convenience path only —
// it never replaces the face identity gate, so it is offered only to a user who
// already has an enrolled face template.
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const body = await req.json();
            const validation = deviceBiometricSchema.safeParse(body);
            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }
            const { type, method, latitude, longitude, batteryPercent, deviceId } = validation.data;

            // Policy: device-biometric punching is only offered to a user who has
            // already enrolled a face template (the real identity gate). Without
            // one, send them back to face registration / verification.
            const template = await prisma.faceTemplate.findUnique({
                where: { userId: user.userId },
                select: { id: true, isActive: true },
            });
            if (!template || template.isActive === false) {
                return errorResponse(
                    'Face not enrolled. Please complete face registration before using fingerprint punch.',
                    403,
                );
            }

            const now = new Date();

            // Resolve branch + today's calendar date (Asia/Kolkata) to upsert Attendance.
            let branchId = user.branchId;
            if (!branchId) {
                const dbUser = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });
                branchId = dbUser?.branchId || undefined;
            }

            const dayCheck = await checkDayAttendanceAllowed(now, branchId || '');
            if (!dayCheck.allowed) {
                return errorResponse(
                    dayCheck.reason || 'Attendance is disabled for today by Admin.',
                    403,
                );
            }

            const { dayStartUtc } = getUtcBoundsForBranchCalendarDay(now, 'Asia/Kolkata');
            const todayYmd = getKolkataCalendarYmd(now);

            // An APPROVED whole-day leave blocks punch-in entirely for the day; an
            // APPROVED half-day leave only blocks punch-in inside its own session
            // window (First/Second Half) — outside that window punch-in is allowed
            // normally. See app/lib/attendance-leave-permission.ts.
            if (type === 'PUNCH_IN') {
                const approvedLeave = await getApprovedLeaveForDay(user.userId, dayStartUtc, now);
                if (approvedLeave) {
                    const message = approvedLeave.isHalfDay && approvedLeave.halfDaySession
                        ? formatHalfDayLeaveBlockedMessage(approvedLeave.leaveTypeName, approvedLeave.halfDaySession, await resolveEmployeeShiftConfig(user.userId))
                        : `You have an approved ${approvedLeave.leaveTypeName} leave today. Punch-in is not available until the leave is cancelled.`;
                    return errorResponse(message, 403);
                }
            }

            // Punch Radius lock (HR → Attendance → Punch Radius): for a locked employee, PUNCH_IN is only
            // accepted within the branch radius, judged on THIS request's own GPS fix and checked before
            // any Attendance / tracking write. Punch-out is never restricted. The FaceVerificationLog row
            // above already holds the attempt's coordinates as evidence of a refused punch.
            if (type === 'PUNCH_IN') {
                const radiusEmployee = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { punchRadiusLocked: true, branch: { select: { name: true, latitude: true, longitude: true } } },
                });
                const radius = checkPunchRadius({
                    locked: radiusEmployee?.punchRadiusLocked ?? false,
                    branch: radiusEmployee?.branch ?? null,
                    latitude,
                    longitude,
                });
                if (!radius.allowed) {
                    return errorResponse(radius.message, 403, { code: radius.code, distanceMeters: radius.distanceMeters });
                }
            }

            const existing = await prisma.attendance.findUnique({
                where: { userId_date: { userId: user.userId, date: dayStartUtc } },
            });

            if (type === 'PUNCH_IN' && (existing?.isHoliday || existing?.status === 'HOLIDAY')) {
                return errorResponse('Today is marked as a Holiday by Admin. Punch-in is disabled.', 403);
            }

            if (type === 'PUNCH_IN' && existing?.checkIn) {
                return errorResponse('You have already punched in today.', 409);
            }
            if (type === 'PUNCH_OUT' && !existing?.checkIn) {
                return errorResponse('Punch-in is required before you can punch out.', 409);
            }
            if (type === 'PUNCH_OUT' && existing?.checkOut) {
                return errorResponse('You have already punched out today.', 409);
            }

            let attendanceId: string;

            // Audit: reuse FaceVerificationLog with the method as the model marker
            // so device-biometric punches show up alongside face punches.
            const verificationLog = await prisma.faceVerificationLog.create({
                data: {
                    userId: user.userId,
                    type,
                    matched: true,
                    scorePercent: 100.0,
                    livenessResult: null,
                    modelVersion: method || 'DEVICE_BIOMETRIC',
                    deviceId,
                    latitude,
                    longitude,
                },
            });

            if (existing) {
                let computedStatus = existing.status;
                let netHours = 0;
                if (type === 'PUNCH_OUT') {
                    if (existing.checkIn) {
                        // Raw punched hours only — approved permission hours no longer come off
                        // this total (see attendance-hr/plan-permission-hours-payroll.md); their
                        // pay consequence, if any, is decided by Payroll from the employee's
                        // total approved permission hours for the month, not here.
                        const diffHours =
                            (now.getTime() - new Date(existing.checkIn).getTime()) /
                            (1000 * 60 * 60);
                        netHours = Math.round(diffHours * 100) / 100;
                        computedStatus = deriveDayStatusFromHours(netHours, await resolveEmployeeShiftConfig(user.userId));
                    } else {
                        computedStatus = 'HALF_DAY';
                    }
                }
                await prisma.attendance.update({
                    where: { id: existing.id },
                    data:
                        type === 'PUNCH_IN'
                            ? {
                                  checkIn: now,
                                  // Corrects a row that was marked ABSENT before the employee
                                  // actually punched in (e.g. the daily register, or the
                                  // Absentee report's backfill) — any active blocking leave
                                  // already returned 403 above, so ABSENT here can only be a
                                  // pre-punch marking, never a real leave day. Every other
                                  // status (HALF_DAY, HOLIDAY, etc.) is left untouched.
                                  ...(existing.status === 'ABSENT' ? { status: 'PRESENT' as const } : {}),
                                  branchId: existing.branchId ?? branchId,
                                  checkInLatitude: latitude,
                                  checkInLongitude: longitude,
                                  checkInFaceLogId: verificationLog.id,
                              }
                            : {
                                  checkOut: now,
                                  status: computedStatus,
                                  branchId: existing.branchId ?? branchId,
                                  checkOutLatitude: latitude,
                                  checkOutLongitude: longitude,
                                  checkOutFaceLogId: verificationLog.id,
                                  workingHours: existing.checkIn ? Math.round(netHours * 100) / 100 : undefined,
                              },
                });
                attendanceId = existing.id;
            } else {
                const created = await prisma.attendance.create({
                    data: {
                        userId: user.userId,
                        date: dayStartUtc,
                        status: 'PRESENT',
                        branchId,
                        ...(type === 'PUNCH_IN'
                            ? {
                                  checkIn: now,
                                  checkInLatitude: latitude,
                                  checkInLongitude: longitude,
                                  checkInFaceLogId: verificationLog.id,
                              }
                            : {
                                  checkOut: now,
                                  checkOutLatitude: latitude,
                                  checkOutLongitude: longitude,
                                  checkOutFaceLogId: verificationLog.id,
                              }),
                    },
                    select: { id: true },
                });
                attendanceId = created.id;
            }

            // Live Employee Tracking (HR Phase 7): anchor the route timeline with a
            // PUNCH_IN/PUNCH_OUT event alongside the Attendance GPS fields above —
            // soft-capture, never blocks the punch itself if GPS wasn't provided.
            // Discrete events live in EmployeeTrackingEvent, not the continuous
            // background-ping table — see attendance-hr/architecture-live-tracking.md.
            // Falls back to the nearest background ping when GPS wasn't sent with the
            // punch, and retries once on a transient insert failure — see
            // recordPunchTrackingEvent in app/lib/hr-tracking.ts. If it still can't
            // resolve GPS right now, queues it for punch-tracking-retry-worker.ts to
            // keep retrying every 30s for up to 15min, once a background ping lands.
            const trackingEventParams = {
                employeeId: user.userId,
                eventType: type,
                latitude,
                longitude,
                batteryPercent,
                branchId,
                capturedAt: now,
                attendanceId,
                logPrefix: '[Device Biometric Punch]',
            };
            const trackingEventCreated = await recordPunchTrackingEvent(trackingEventParams);
            if (!trackingEventCreated) {
                const { enqueuePunchRetry } = await import('@/app/lib/punch-tracking-retry-worker');
                enqueuePunchRetry(trackingEventParams);
            }

            return successResponse(
                {
                    recorded: true,
                    matched: true,
                    type,
                    recordedAt: now.toISOString(),
                    attendanceDate: todayYmd,
                },
                'Attendance confirmed with device fingerprint.',
            );
        } catch (error: unknown) {
            console.error('[Device Biometric Punch] Error:', error);
            const message =
                error instanceof Error ? error.message : 'Failed to record attendance';
            return errorResponse(message, 500);
        }
    })(request);
}
