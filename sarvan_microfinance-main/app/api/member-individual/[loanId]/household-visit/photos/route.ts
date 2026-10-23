import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { uploadMemberIndividualPhoto } from '@/app/lib/storage/member-individual-storage';
import { isLocationMatch, HOUSEHOLD_VISIT_CENTER_RADIUS_METERS, LOCATION_MATCH_RADIUS_METERS } from '@/app/lib/location-utils';
import { getDrivingDistanceMeters } from '@/app/lib/services/geo-routing.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 8 * 1024 * 1024; // 8 MB

/**
 * POST /api/member-individual/[loanId]/household-visit/photos
 * Uploads a house visit photo with captured GPS. The mandatory photo must be:
 *  - within HOUSEHOLD_VISIT_CENTER_RADIUS_METERS (500m) of the client's center, AND
 *  - within LOCATION_MATCH_RADIUS_METERS (100m, accuracy-tolerant) of the
 *    client's FDO-enrolled location (Client.latitude/longitude) — skipped if
 *    the client has no enrolled location on file.
 * Otherwise the upload is rejected and the tab cannot be marked complete.
 * Distance from the branch (Branch.latitude/longitude) is also recorded, for
 * display only — it is not part of the pass/fail gate.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    return withRole(['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req, user) => {
        try {
            const { loanId } = await params;

            const memberIndividual = await prisma.memberIndividual.findUnique({
                where: { loanId },
                select: { id: true, centerId: true, clientId: true, branchId: true },
            });
            if (!memberIndividual) return errorResponse('Member Individual record not found — open the loan first', 404);

            const [center, client, branch] = await Promise.all([
                prisma.center.findUnique({ where: { id: memberIndividual.centerId }, select: { latitude: true, longitude: true } }),
                prisma.client.findUnique({ where: { id: memberIndividual.clientId }, select: { latitude: true, longitude: true } }),
                prisma.branch.findUnique({ where: { id: memberIndividual.branchId }, select: { latitude: true, longitude: true } }),
            ]);

            const formData = await req.formData();
            const file = formData.get('photo') as File | null;
            const latitudeRaw = formData.get('latitude') as string | null;
            const longitudeRaw = formData.get('longitude') as string | null;
            const accuracyRaw = formData.get('accuracy') as string | null;
            const isMandatory = formData.get('isMandatory') === 'true';
            const notes = (formData.get('notes') as string | null) ?? null;

            if (!file) return errorResponse('No photo provided', 400);
            if (!ALLOWED_TYPES.includes(file.type)) return errorResponse('Only JPEG, PNG or WebP images are allowed', 400);
            if (file.size > MAX_SIZE) return errorResponse('Photo size must be under 8 MB', 400);

            const latitude = latitudeRaw != null ? parseFloat(latitudeRaw) : null;
            const longitude = longitudeRaw != null ? parseFloat(longitudeRaw) : null;
            const accuracy = accuracyRaw != null ? parseFloat(accuracyRaw) : null;

            // Road (driving) distance, not straight-line — matches Create Center's
            // "KM From Branch" so distance figures read consistently across the app.
            let distanceMeters: number | null = null;
            if (latitude != null && longitude != null && center?.latitude != null && center?.longitude != null) {
                distanceMeters = (await getDrivingDistanceMeters(latitude, longitude, center.latitude, center.longitude)).distanceMeters;
            }

            let distanceFromClientMeters: number | null = null;
            if (latitude != null && longitude != null && client?.latitude != null && client?.longitude != null) {
                distanceFromClientMeters = (await getDrivingDistanceMeters(latitude, longitude, client.latitude, client.longitude)).distanceMeters;
            }

            // Informational only — not part of the mandatory-photo range gate below.
            let distanceFromBranchMeters: number | null = null;
            if (latitude != null && longitude != null && branch?.latitude != null && branch?.longitude != null) {
                distanceFromBranchMeters = (await getDrivingDistanceMeters(latitude, longitude, branch.latitude, branch.longitude)).distanceMeters;
            }

            if (isMandatory) {
                if (latitude == null || longitude == null) {
                    return errorResponse('Location is required to capture the mandatory house photo', 400);
                }
                if (distanceMeters == null) {
                    return errorResponse('Center location is not set — cannot verify house visit distance', 400);
                }
                if (distanceMeters > HOUSEHOLD_VISIT_CENTER_RADIUS_METERS) {
                    return errorResponse(
                        `Captured location is ${Math.round(distanceMeters)}m from the client's center — must be within ${HOUSEHOLD_VISIT_CENTER_RADIUS_METERS}m. Cannot approve this client.`,
                        400
                    );
                }
                // Compare against the FDO's enrollment-time location, if one was captured.
                if (distanceFromClientMeters != null && !isLocationMatch(distanceFromClientMeters, accuracy, LOCATION_MATCH_RADIUS_METERS)) {
                    return errorResponse(
                        `Captured location is ${Math.round(distanceFromClientMeters)}m from the location FDO recorded at enrollment — must be within ${LOCATION_MATCH_RADIUS_METERS}m. Cannot approve this client.`,
                        400
                    );
                }
            }

            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const upload = await uploadMemberIndividualPhoto({
                fileBuffer: buffer,
                contentType: file.type,
                fileName: file.name,
                loanId,
            });

            const photo = await prisma.memberIndividualPhoto.create({
                data: {
                    memberIndividualId: memberIndividual.id,
                    photoUrl: upload.photoUrl,
                    photoKey: upload.photoKey,
                    isMandatory,
                    latitude,
                    longitude,
                    distanceMeters,
                    distanceFromClientMeters,
                    distanceFromBranchMeters,
                    notes,
                    uploadedById: user.userId,
                },
            });

            if (isMandatory) {
                await prisma.memberIndividual.update({
                    where: { id: memberIndividual.id },
                    data: {
                        visitLatitude: latitude,
                        visitLongitude: longitude,
                        visitDistanceMeters: distanceMeters,
                        visitDistanceFromClientMeters: distanceFromClientMeters,
                        visitDistanceFromBranchMeters: distanceFromBranchMeters,
                    },
                });
            }

            return successResponse({
                id: photo.id, photoUrl: photo.photoUrl, isMandatory: photo.isMandatory,
                latitude: photo.latitude, longitude: photo.longitude,
                distanceMeters: photo.distanceMeters, distanceFromClientMeters: photo.distanceFromClientMeters,
                distanceFromBranchMeters: photo.distanceFromBranchMeters,
            }, 'Photo uploaded successfully');
        } catch (error: any) {
            console.error('Error uploading household visit photo:', error);
            return errorResponse(error.message || 'Failed to upload photo', 500);
        }
    })(request);
}
