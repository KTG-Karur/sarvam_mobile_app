import { prisma } from '@/app/lib/prisma';
import type { WorkingHoursConfig } from '@/app/lib/attendance-config';

const SETTING_ID = 'default';

export const DEFAULT_WORKING_HOURS: WorkingHoursConfig = {
  shiftStart: '09:30',
  shiftEnd: '18:00',
  fullDayHours: 8,
  halfDayHours: 0,
  graceMinutes: 15,
  permissionHoursLopThreshold: 6,
  autoCheckoutTime: '23:59',
};

function toConfig(row: {
  shiftStart: string;
  shiftEnd: string;
  fullDayHours: number;
  halfDayHours: number;
  graceMinutes: number;
  permissionHoursLopThreshold: number;
  autoCheckoutTime: string;
}): WorkingHoursConfig {
  return {
    shiftStart: row.shiftStart,
    shiftEnd: row.shiftEnd,
    fullDayHours: row.fullDayHours,
    halfDayHours: row.halfDayHours,
    graceMinutes: row.graceMinutes,
    permissionHoursLopThreshold: row.permissionHoursLopThreshold,
    autoCheckoutTime: row.autoCheckoutTime,
  };
}

export async function getWorkingHours(): Promise<WorkingHoursConfig> {
  const row = await prisma.workingHoursSetting.findUnique({ where: { id: SETTING_ID } });
  return row ? toConfig(row) : DEFAULT_WORKING_HOURS;
}

export async function saveWorkingHours(
  patch: Partial<WorkingHoursConfig>,
  updatedById?: string,
): Promise<WorkingHoursConfig> {
  const merged = { ...(await getWorkingHours()), ...patch };
  const row = await prisma.workingHoursSetting.upsert({
    where: { id: SETTING_ID },
    create: { id: SETTING_ID, ...merged, updatedById },
    update: { ...merged, updatedById },
  });
  return toConfig(row);
}
