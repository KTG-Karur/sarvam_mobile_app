export interface WorkingHoursConfig {
  shiftStart: string;     // 'HH:MM' — scheduled shift start
  shiftEnd: string;       // 'HH:MM' — scheduled shift end
  fullDayHours: number;   // worked hours ≥ this ⇒ FULL_DAY
  halfDayHours: number;   // worked hours ≥ this (but < fullDayHours) ⇒ HALF_DAY; below ⇒ ABSENT. 0 disables the ABSENT floor.
  graceMinutes: number;   // late-arrival grace after shiftStart
  // Total APPROVED permission hours per employee per calendar month at/above
  // which Payroll's Salary Pay auto-fill switches the "Permission Deduction"
  // line item from a proportional (hours × hourly rate) amount to one full
  // day's pay — see attendance-hr/plan-permission-hours-payroll.md. The admin
  // can always override the auto-filled amount before submitting either way.
  permissionHoursLopThreshold: number;
  // Time-of-day (HH:MM, Asia/Kolkata) an open punch (checkIn set, checkOut
  // still null) gets auto-closed at, when the Daily Register is saved for a
  // PAST date — see app/api/payroll/attendance/route.ts's POST handler.
  // Never applied to today's date, for the same reason the week-off default
  // excludes today: the employee may still be expected to punch out later.
  autoCheckoutTime: string;
}

/**
 * Day status from worked hours, using the given thresholds — the punching employee's own
 * Shift if assigned, else the global Default Shift (see resolveEmployeeShiftConfig and
 * the `WorkingHoursSetting` table), see attendance-hr/plan-multi-shift.md.
 * Used by the punch routes on punch-out.
 *   hours >= halfDayHours   -> PRESENT (Full Day worked)
 *   hours < halfDayHours    -> HALF_DAY
 */
export function deriveDayStatusFromHours(
  hours: number,
  thresholds: Pick<WorkingHoursConfig, 'halfDayHours'>,
): 'PRESENT' | 'HALF_DAY' | 'ABSENT' {
  if (hours >= thresholds.halfDayHours) return 'PRESENT';
  return 'HALF_DAY';
}
