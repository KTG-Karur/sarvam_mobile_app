import { prisma } from '@/app/lib/db';
import type { WorkingHoursConfig } from '@/app/lib/attendance-config';
import { getWorkingHours } from '@/app/lib/working-hours';

/**
 * Per-employee punch/attendance thresholds — the employee's own assigned Shift
 * (Shift Management, HR Administration) if one is set and active, else the shift
 * flagged `isDefault` (the fallback for unassigned employees, set on the Shift
 * Management page), else the legacy Working Hours JSON config as a last-resort
 * safety net for the (should-never-happen-in-practice) case where no default
 * shift has been configured yet. Always returns a usable config — never null —
 * so every caller can use the result directly without a fallback branch of its own.
 */
export type ResolvedShiftConfig = Pick<WorkingHoursConfig, 'shiftStart' | 'shiftEnd' | 'fullDayHours' | 'halfDayHours' | 'graceMinutes'> & {
    shiftId: string | null;
    shiftName: string | null;
};

const SHIFT_SELECT = { id: true, name: true, shiftStart: true, shiftEnd: true, fullDayHours: true, halfDayHours: true, graceMinutes: true, isActive: true } as const;

type ShiftRow = { id: string; name: string; shiftStart: string; shiftEnd: string; fullDayHours: number; halfDayHours: number; graceMinutes: number; isActive: boolean };

function fromShiftRow(s: ShiftRow): ResolvedShiftConfig {
    return { shiftId: s.id, shiftName: s.name, shiftStart: s.shiftStart, shiftEnd: s.shiftEnd, fullDayHours: s.fullDayHours, halfDayHours: s.halfDayHours, graceMinutes: s.graceMinutes };
}

async function fromLegacyConfig(): Promise<ResolvedShiftConfig> {
    const wh = await getWorkingHours();
    return { shiftId: null, shiftName: null, shiftStart: wh.shiftStart, shiftEnd: wh.shiftEnd, fullDayHours: wh.fullDayHours, halfDayHours: wh.halfDayHours, graceMinutes: wh.graceMinutes };
}

/** The shift flagged as the company default, or the legacy Working Hours config if none is set yet. */
export async function resolveDefaultShiftConfig(): Promise<ResolvedShiftConfig> {
    const defaultShift = await (prisma as any).shift.findFirst({ where: { isDefault: true, isActive: true }, select: SHIFT_SELECT });
    return defaultShift ? fromShiftRow(defaultShift) : fromLegacyConfig();
}

export async function resolveEmployeeShiftConfig(employeeId: string): Promise<ResolvedShiftConfig> {
    const employee = await prisma.user.findUnique({
        where: { id: employeeId },
        select: { shiftId: true, shift: { select: SHIFT_SELECT } },
    });

    if (employee?.shift?.isActive) {
        return fromShiftRow(employee.shift);
    }

    return resolveDefaultShiftConfig();
}
