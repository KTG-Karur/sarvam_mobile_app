import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';
import { errorResponse, handleCorsPreflight, successResponse, withAuth } from '@/app/lib/api-utils';
import { checkFaceTrainingAllowed } from '@/app/lib/face-settings';
import { checkDayAttendanceAllowed, getWeekConfiguration } from '@/app/lib/attendance-schedule';
import { getApprovedLeaveForDay } from '@/app/lib/attendance-leave-permission';
import { PUNCH_RADIUS_METERS, PUNCH_RADIUS_MAX_ALLOWED_METERS } from '@/app/lib/punch-radius';

export async function OPTIONS() {
  return handleCorsPreflight();
}

// The app must use this server record rather than stale SharedPreferences to
// render today's Present/Absent status.
export async function GET(_request: NextRequest) {
  return withAuth(async (_req, user) => {
    try {
      const now = new Date();
      const { dayStartUtc } = getUtcBoundsForBranchCalendarDay(now, 'Asia/Kolkata');
      const [attendance, faceTemplate, approvedReReg, approvedLeaveToday] = await Promise.all([
        prisma.attendance.findUnique({
          where: { userId_date: { userId: user.userId, date: dayStartUtc } },
          select: { checkIn: true, checkOut: true, status: true, isHoliday: true },
        }),
        prisma.faceTemplate.findUnique({
          where: { userId: user.userId },
          select: { id: true },
        }),
        prisma.faceReRegistrationRequest.findFirst({
          where: { userId: user.userId, status: 'APPROVED' },
          select: { id: true },
        }),
        getApprovedLeaveForDay(user.userId, dayStartUtc),
      ]);

      let branchId = user.branchId;
      if (!branchId) {
        const dbUser = await prisma.user.findUnique({
          where: { id: user.userId },
          select: { branchId: true },
        });
        branchId = dbUser?.branchId || undefined;
      }

      // Punch Radius lock — lets the app show "be within 100 m of the branch to punch in".
      const radiusRow = await prisma.user.findUnique({ where: { id: user.userId }, select: { punchRadiusLocked: true } });

      const isPunchedOut = Boolean(attendance?.checkOut);
      // Once checkOut is set, attendance.status is already the punch-out route's
      // derived value (net of any approved permission hours for the day) — trust
      // it rather than re-deriving from raw checkIn/checkOut here, which would
      // silently ignore that deduction.
      let computedStatus = attendance?.status ?? null;
      if (!(attendance?.checkIn && attendance?.checkOut) && isPunchedOut && (!computedStatus || computedStatus === 'PRESENT')) {
        computedStatus = 'HALF_DAY';
      }

      const [dayCheck, schedule] = await Promise.all([
        checkDayAttendanceAllowed(now, branchId || ''),
        getWeekConfiguration(branchId || ''),
      ]);
      const trainingCheck = await checkFaceTrainingAllowed();

      const isHoliday = Boolean(attendance?.isHoliday || attendance?.status === 'HOLIDAY');
      const holidayBlockReason = isHoliday && !approvedLeaveToday
        ? 'Today is marked as a Holiday by Admin. Punch-in is disabled.'
        : null;

      // Enrolment gate: first-time enrolment is always allowed (subject to the
      // global Admin toggle). Re-registering an EXISTING template needs an
      // approved FaceReRegistrationRequest.
      const isEnrolled = Boolean(faceTemplate);
      const hasReRegApproval = Boolean(approvedReReg);
      const faceTrainingAllowed =
        trainingCheck.allowed && (!isEnrolled || hasReRegApproval);
      const trainingReason = !faceTrainingAllowed
        ? isEnrolled && !hasReRegApproval && trainingCheck.allowed
          ? 'Re-registering your face needs Admin approval. Request it from the app.'
          : trainingCheck.reason
        : undefined;

      // An approved leave for today blocks punch-in the same way the punch
      // routes themselves do — surfaced here so the app can show it without
      // making a failing punch attempt first.
      const leaveBlockReason = approvedLeaveToday && !attendance?.checkIn
        ? `You have an approved ${approvedLeaveToday.leaveTypeName} leave today. Punch-in is not available until the leave is cancelled.`
        : null;

      const accessMessage =
        dayCheck.reason ?? leaveBlockReason ?? holidayBlockReason ?? trainingReason ?? null;

      return successResponse({
        // A completed shift is still a Present day; checkOut only indicates
        // that the employee has finished the shift.
        present: Boolean(attendance?.checkIn) || isPunchedOut,
        punchedIn: Boolean(attendance?.checkIn),
        punchedOut: isPunchedOut,
        status: computedStatus,
        enrolled: isEnrolled,
        // Admin Access Controls:
        isWorkingDay: dayCheck.isWorkingDay && !isHoliday,
        faceAttendanceAllowed: dayCheck.allowed && !leaveBlockReason && !isHoliday,
        faceTrainingAllowed,
        accessMessage,
        approvedLeaveToday: approvedLeaveToday ? { leaveType: approvedLeaveToday.leaveTypeName } : null,
        punchRadius: {
          locked: radiusRow?.punchRadiusLocked ?? false,
          radiusMeters: PUNCH_RADIUS_METERS,
          maxAllowedMeters: PUNCH_RADIUS_MAX_ALLOWED_METERS,
        },
        schedule,
      });
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Failed to fetch attendance status', 500);
    }
  })(_request);
}
