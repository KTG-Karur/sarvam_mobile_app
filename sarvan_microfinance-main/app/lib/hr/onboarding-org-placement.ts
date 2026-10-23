import { prisma } from '@/app/lib/db';

/** Region / Division / Shift picked when the request is raised must exist, be active, and agree with each other. */
export async function validateOnboardingOrgPlacement(p: { regionId?: string | null; divisionId?: string | null; shiftId?: string | null }): Promise<string | null> {
    if (p.regionId) {
        const region = await prisma.region.findUnique({ where: { id: p.regionId }, select: { isActive: true } });
        if (!region || !region.isActive) return 'Selected region is not valid';
    }
    if (p.divisionId) {
        const division = await prisma.division.findUnique({ where: { id: p.divisionId }, select: { isActive: true, regionId: true } });
        if (!division || !division.isActive) return 'Selected division is not valid';
        if (p.regionId && division.regionId !== p.regionId) return 'Selected division does not belong to the selected region';
    }
    if (p.shiftId) {
        const shift = await prisma.shift.findUnique({ where: { id: p.shiftId }, select: { isActive: true } });
        if (!shift || !shift.isActive) return 'Selected shift is not valid';
    }
    return null;
}
