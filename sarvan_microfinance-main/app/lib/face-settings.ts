import { prisma } from '@/app/lib/prisma';

export interface FaceSettings {
  faceAttendanceEnabled: boolean;
  faceTrainingEnabled: boolean;
}

const SETTING_ID = 'default';
const DEFAULTS: FaceSettings = { faceAttendanceEnabled: true, faceTrainingEnabled: true };

export async function getFaceSettings(): Promise<FaceSettings> {
  const row = await prisma.faceAttendanceSetting.findUnique({ where: { id: SETTING_ID } });
  return row
    ? { faceAttendanceEnabled: row.faceAttendanceEnabled, faceTrainingEnabled: row.faceTrainingEnabled }
    : DEFAULTS;
}

export async function saveFaceSettings(patch: Partial<FaceSettings>, updatedById?: string): Promise<FaceSettings> {
  const merged = { ...(await getFaceSettings()), ...patch };
  const row = await prisma.faceAttendanceSetting.upsert({
    where: { id: SETTING_ID },
    create: { id: SETTING_ID, ...merged, updatedById },
    update: { ...merged, updatedById },
  });
  return { faceAttendanceEnabled: row.faceAttendanceEnabled, faceTrainingEnabled: row.faceTrainingEnabled };
}

export async function checkFaceTrainingAllowed(): Promise<{ allowed: boolean; reason?: string }> {
  const { faceTrainingEnabled } = await getFaceSettings();
  return faceTrainingEnabled ? { allowed: true } : { allowed: false, reason: 'Face training is disabled by Admin.' };
}
