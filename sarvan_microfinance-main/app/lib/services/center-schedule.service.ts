import { prisma } from '@/app/lib/db';
import { normalizeMeetingTime } from '@/app/lib/utils/meeting-time';

/**
 * Finds another active center already assigned to the same FDO on the same
 * meeting day at the same (normalized) meeting time.
 */
export async function findConflictingCenterSchedule(params: {
    fdoId: string;
    meetingDay: string;
    meetingTime: string;
    excludeCenterId?: string;
}): Promise<{ id: string; name: string } | null> {
    const { fdoId, meetingDay, meetingTime, excludeCenterId } = params;
    const targetTime = normalizeMeetingTime(meetingTime);

    const candidates = await prisma.center.findMany({
        where: {
            fdoId,
            meetingDay: { equals: meetingDay.trim(), mode: 'insensitive' },
            isActive: true,
            ...(excludeCenterId ? { id: { not: excludeCenterId } } : {}),
        },
        select: { id: true, name: true, meetingTime: true },
    });

    const conflict = candidates.find(
        (center) => center.meetingTime && normalizeMeetingTime(center.meetingTime) === targetTime
    );

    return conflict ? { id: conflict.id, name: conflict.name } : null;
}
