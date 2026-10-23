import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { HOUSEHOLD_VISIT_CENTER_RADIUS_METERS, LOCATION_MATCH_RADIUS_METERS } from '@/app/lib/location-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * PATCH /api/member-individual/[loanId]/household-visit/complete
 * Validates a mandatory, in-range photo exists before marking the tab complete.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    return withRole(['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req, user) => {
        try {
            const { loanId } = await params;

            const memberIndividual = await prisma.memberIndividual.findUnique({
                where: { loanId },
                include: { photos: { where: { isMandatory: true } } },
            });
            if (!memberIndividual) return errorResponse('Member Individual record not found — open the loan first', 404);

            const mandatoryPhoto = memberIndividual.photos[0];
            if (!mandatoryPhoto) {
                return errorResponse('Capture the mandatory house photo with location before completing this tab', 400);
            }
            if (mandatoryPhoto.distanceMeters == null || mandatoryPhoto.distanceMeters > HOUSEHOLD_VISIT_CENTER_RADIUS_METERS) {
                return errorResponse(
                    `Mandatory photo is outside the ${HOUSEHOLD_VISIT_CENTER_RADIUS_METERS}m center range — cannot approve this client`,
                    400
                );
            }
            if (mandatoryPhoto.distanceFromClientMeters != null && mandatoryPhoto.distanceFromClientMeters > LOCATION_MATCH_RADIUS_METERS) {
                return errorResponse(
                    `Mandatory photo is outside the ${LOCATION_MATCH_RADIUS_METERS}m range of the location FDO recorded at enrollment — cannot approve this client`,
                    400
                );
            }

            const updated = await prisma.memberIndividual.update({
                where: { loanId },
                data: {
                    houseHoldVisitCompletedAt: new Date(),
                    houseHoldVisitCompletedById: user.userId,
                },
            });

            return successResponse({ completedAt: updated.houseHoldVisitCompletedAt }, 'House Hold Visit marked complete');
        } catch (error: any) {
            console.error('Error completing House Hold Visit:', error);
            return errorResponse(error.message || 'Failed to complete House Hold Visit', 500);
        }
    })(request);
}
