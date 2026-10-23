import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    errorResponse,
    successResponse,
    withAuth,
    handleCorsPreflight,
} from '@/app/lib/api-utils';
import { z } from 'zod';
import { computeFaceMatchScore, FACE_MATCH_THRESHOLD } from '@/app/lib/face-match';
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

const verifySchema = z.object({
    type: z.enum(['PUNCH_IN', 'PUNCH_OUT']),
    featureVector: z.array(z.number()).min(1),
    livenessVerified: z.boolean().optional().default(true),
    qualityScore: z.number().optional().default(100.0),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    batteryPercent: z.number().min(0).max(100).optional(),
    deviceId: z.string().optional(),
});

export async function OPTIONS() {
    return handleCorsPreflight();
}

// POST /api/auth/face/verify — authoritative server-side check for punch in/out.
// Compares the live probe embedding against the caller's enrolled FaceTemplate (multi-embeddings),
// logs every attempt (matched or not) to FaceVerificationLog, and on a match
// upserts today's Attendance checkIn/checkOut.
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        const startTime = Date.now();
        try {
            const body = await req.json();
            const validation = verifySchema.safeParse(body);
            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }
            const { type, featureVector, livenessVerified, qualityScore, latitude, longitude, batteryPercent, deviceId } = validation.data;

            const template = await prisma.faceTemplate.findUnique({
                where: { userId: user.userId },
            });

            if (!template || template.isActive === false) {
                return errorResponse('Face not enrolled. Please complete face registration first.', 409);
            }

            // Extract enrolled vectors: template.embeddings (multi-sample array) or template.featureVector
            const enrolledEmbeddings = template.embeddings
                ? (template.embeddings as unknown as number[][])
                : (template.featureVector as unknown as number[]);

            const matchResult = computeFaceMatchScore(featureVector, enrolledEmbeddings);
            const { matched, scorePercent, similarityScore, distanceScore } = matchResult;
            const processingTimeMs = Date.now() - startTime;

            const verificationLog = await prisma.faceVerificationLog.create({
                data: {
                    userId: user.userId,
                    type,
                    matched,
                    scorePercent,
                    similarityScore,
                    distanceScore,
                    threshold: FACE_MATCH_THRESHOLD,
                    livenessResult: livenessVerified,
                    faceQuality: qualityScore,
                    modelVersion: template.modelVersion || 'MobileFaceNet_v1.0',
                    processingTimeMs,
                    deviceId,
                    latitude,
                    longitude,
                },
            });

            if (!matched) {
                return successResponse(
                    {
                        matched: false,
                        scorePercent,
                        similarityScore,
                        distanceScore,
                        code: 'FACE_MISMATCH'
                    },
                    `Face mismatch (${scorePercent.toFixed(1)}% match). Please position your face inside the green oval.`
                );
            }

            // Resolve branch + today's calendar date (Asia/Kolkata) to upsert Attendance
            let branchId = user.branchId;
            if (!branchId) {
                const dbUser = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });
                branchId = dbUser?.branchId || undefined;
            }

            const now = new Date();
            const dayCheck = await checkDayAttendanceAllowed(now, branchId || '');
            if (!dayCheck.allowed) {
                return errorResponse(dayCheck.reason || 'Face attendance is disabled for today by Admin.', 403);
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

            if (existing) {
                let computedStatus = existing.status;
                let netHours = 0;
                if (type === 'PUNCH_OUT') {
                    if (existing.checkIn) {
                        // Raw punched hours only — approved permission hours no longer come off
                        // this total (see attendance-hr/plan-permission-hours-payroll.md); their
                        // pay consequence, if any, is decided by Payroll from the employee's
                        // total approved permission hours for the month, not here.
                        const diffHours = (now.getTime() - new Date(existing.checkIn).getTime()) / (1000 * 60 * 60);
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
                logPrefix: '[Face Verify]',
            };
            const trackingEventCreated = await recordPunchTrackingEvent(trackingEventParams);
            if (!trackingEventCreated) {
                const { enqueuePunchRetry } = await import('@/app/lib/punch-tracking-retry-worker');
                enqueuePunchRetry(trackingEventParams);
            }

            return successResponse(
                {
                    matched: true,
                    scorePercent,
                    similarityScore,
                    distanceScore,
                    attendanceDate: todayYmd
                },
                `Face verified successfully (${scorePercent.toFixed(1)}% match).`
            );
        } catch (error: unknown) {
            console.error('[Face Verify] Error:', error);
            const message = error instanceof Error ? error.message : 'Failed to verify face';
            return errorResponse(message, 500);
        }
    })(request);
}
