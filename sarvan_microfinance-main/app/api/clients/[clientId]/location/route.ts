import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withAuth, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { z } from 'zod';
import { isLocationMatch, LOCATION_MATCH_RADIUS_METERS, CENTER_MATCH_RADIUS_METERS } from '@/app/lib/location-utils';
import { getDrivingDistanceMeters } from '@/app/lib/services/geo-routing.service';

export async function OPTIONS() { return handleCorsPreflight(); }

// ── GET: full location info (client coords, house images, QR, approval status) ──────────────────
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> },
) {
    return withAuth(async (_req, _user) => {
        try {
            const { clientId } = await params;

            // findFirst, not findUnique — clientId isn't DB-unique (uploan-imported
            // legacy IDs can intentionally collide) — deterministic oldest-created
            // tiebreak, matching every other clientId lookup in the app.
            const client = await prisma.client.findFirst({
                where: { OR: [{ id: clientId }, { clientId }] },
                orderBy: { createdAt: 'asc' },
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    permanentAddress: true,
                    latitude: true,
                    longitude: true,
                    locationApprovalStatus: true,
                    locationApprovedAt: true,
                    locationApprovalRemarks: true,
                    bmVisitLatitude: true,
                    bmVisitLongitude: true,
                    pendingLatitude: true,
                    pendingLongitude: true,
                    relocationRequestedAt: true,
                    relocationRemarks: true,
                    locationApprovedBy: {
                        select: { id: true, firstName: true, lastName: true },
                    },
                    relocationRequestedBy: {
                        select: { id: true, firstName: true, lastName: true },
                    },
                    kycDocuments: {
                        where: {
                            documentType: {
                                in: ['house_image_1', 'house_image_2', 'house_image_3', 'location_qr'],
                            },
                        },
                        select: {
                            id: true,
                            documentType: true,
                            fileUrl: true,
                            fileName: true,
                        },
                    },
                    center: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                            latitude: true,
                            longitude: true,
                            branch: {
                                select: { id: true, name: true, latitude: true, longitude: true },
                            },
                        },
                    },
                },
            });

            if (!client) return errorResponse('Client not found', 404);

            // Road (driving) distance, not straight-line — matches Create Center's
            // "KM From Branch" so distance figures read consistently across the app.
            const [lastVisitResult, centerResult, branchResult] = await Promise.all([
                (client.latitude != null && client.longitude != null &&
                    client.bmVisitLatitude != null && client.bmVisitLongitude != null)
                    ? getDrivingDistanceMeters(client.latitude, client.longitude, client.bmVisitLatitude, client.bmVisitLongitude)
                    : null,
                (client.latitude != null && client.longitude != null &&
                    client.center?.latitude != null && client.center?.longitude != null)
                    ? getDrivingDistanceMeters(client.latitude, client.longitude, client.center.latitude, client.center.longitude)
                    : null,
                (client.latitude != null && client.longitude != null &&
                    client.center?.branch?.latitude != null && client.center?.branch?.longitude != null)
                    ? getDrivingDistanceMeters(client.latitude, client.longitude, client.center.branch.latitude, client.center.branch.longitude)
                    : null,
            ]);

            const lastVisitDistance = lastVisitResult?.distanceMeters ?? null;
            const distanceFromCenterMeters = centerResult?.distanceMeters ?? null;
            const distanceFromBranchMeters = branchResult?.distanceMeters ?? null;

            return successResponse({
                client,
                lastVisitDistance,
                distanceFromCenterMeters,
                distanceFromBranchMeters,
                matchRadiusMeters: LOCATION_MATCH_RADIUS_METERS,
            }, 'Location info fetched');
        } catch (error) {
            console.error('Error fetching client location:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch location', 500);
        }
    })(request);
}

// ── POST: BM approves OR FDO/BM requests action ─────────────────────────────────────────────────
// Body: { action: 'approve'|'reject'|'relocate'|'approve_relocation'|'reject_relocation', ... }
const ActionSchema = z.discriminatedUnion('action', [
    z.object({
        action: z.literal('approve'),
        bmLatitude: z.number(),
        bmLongitude: z.number(),
        bmAccuracy: z.number().optional(),
        remarks: z.string().optional(),
    }),
    z.object({
        action: z.literal('reject'),
        remarks: z.string().min(1, 'Rejection remarks are required'),
    }),
    z.object({
        action: z.literal('relocate'),
        newLatitude: z.number(),
        newLongitude: z.number(),
        remarks: z.string().min(1, 'Relocation reason is required'),
    }),
    z.object({
        action: z.literal('approve_relocation'),
        bmLatitude: z.number(),
        bmLongitude: z.number(),
        bmAccuracy: z.number().optional(),
        remarks: z.string().optional(),
    }),
    z.object({
        action: z.literal('reject_relocation'),
        remarks: z.string().min(1, 'Rejection remarks are required'),
    }),
]);

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> },
) {
    return withAuth(async (req, user) => {
        try {
            const { clientId } = await params;
            const body = await req.json();
            const parsed = ActionSchema.parse(body);

            const client = await prisma.client.findFirst({
                where: { OR: [{ id: clientId }, { clientId }] },
                orderBy: { createdAt: 'asc' },
                select: {
                    id: true,
                    clientId: true,
                    latitude: true,
                    longitude: true,
                    locationApprovalStatus: true,
                    pendingLatitude: true,
                    pendingLongitude: true,
                    centerId: true,
                    center: { select: { latitude: true, longitude: true } },
                },
            });
            if (!client) return errorResponse('Client not found', 404);

            const now = new Date();

            const formatMeters = (m: number) => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;

            // Road (driving) distance (in metres) between a target lat/lng and the client's
            // assigned center, or null if either coordinate is unavailable.
            const centerDistanceMeters = async (lat: number | null, lng: number | null): Promise<number | null> => {
                if (lat == null || lng == null || client.center?.latitude == null || client.center?.longitude == null) {
                    return null;
                }
                const { distanceMeters } = await getDrivingDistanceMeters(lat, lng, client.center.latitude, client.center.longitude);
                return distanceMeters;
            };

            // Road (driving) distance (in metres) between the BM's captured GPS and the
            // FDO-verified client location (baseLat/baseLng), or null if unavailable.
            const fdoMatchDistanceMeters = async (
                baseLat: number | null, baseLng: number | null,
                bmLat: number, bmLng: number,
            ): Promise<number | null> => {
                if (baseLat == null || baseLng == null) return null;
                const { distanceMeters } = await getDrivingDistanceMeters(baseLat, baseLng, bmLat, bmLng);
                return distanceMeters;
            };

            switch (parsed.action) {
                // ── BM: Approve enrolled location ──────────────────────────────────────────
                case 'approve': {
                    if (!['BRANCH_MANAGER', 'ADMIN'].includes(user.role)) {
                        return errorResponse('Only Branch Manager can approve location', 403);
                    }
                    if (client.locationApprovalStatus === 'APPROVED') {
                        return errorResponse('Location is already approved', 400);
                    }
                    if (!client.centerId) {
                        return errorResponse('Please assign a center to this client before approving location.', 400);
                    }
                    {
                        const distM = await centerDistanceMeters(client.latitude, client.longitude);
                        if (distM != null && distM > CENTER_MATCH_RADIUS_METERS) {
                            return errorResponse(
                                `Client location is ${formatMeters(distM)} from the assigned center — exceeds the ${formatMeters(CENTER_MATCH_RADIUS_METERS)} limit.`,
                                400
                            );
                        }
                    }
                    {
                        const visitDistM = await fdoMatchDistanceMeters(client.latitude, client.longitude, parsed.bmLatitude, parsed.bmLongitude);
                        if (visitDistM != null && !isLocationMatch(visitDistM, parsed.bmAccuracy)) {
                            return errorResponse(
                                `Your GPS location is ${formatMeters(visitDistM)} from the FDO-verified client location — exceeds the ${formatMeters(LOCATION_MATCH_RADIUS_METERS)} match limit.`,
                                400
                            );
                        }
                    }
                    await prisma.client.update({
                        where: { id: client.id },
                        data: {
                            locationApprovalStatus: 'APPROVED',
                            locationApprovedById: user.userId,
                            locationApprovedAt: now,
                            locationApprovalRemarks: parsed.remarks ?? null,
                            bmVisitLatitude: parsed.bmLatitude,
                            bmVisitLongitude: parsed.bmLongitude,
                        },
                    });
                    return successResponse({ status: 'APPROVED' }, 'Location approved successfully');
                }

                // ── BM: Reject enrolled location ───────────────────────────────────────────
                case 'reject': {
                    if (!['BRANCH_MANAGER', 'ADMIN'].includes(user.role)) {
                        return errorResponse('Only Branch Manager can reject location', 403);
                    }
                    await prisma.client.update({
                        where: { id: client.id },
                        data: {
                            locationApprovalStatus: 'REJECTED',
                            locationApprovedById: user.userId,
                            locationApprovedAt: now,
                            locationApprovalRemarks: parsed.remarks,
                        },
                    });
                    return successResponse({ status: 'REJECTED' }, 'Location rejected');
                }

                // ── FDO: Request relocation with new coordinates ────────────────────────────
                case 'relocate': {
                    if (client.locationApprovalStatus === 'RELOCATION_REQUESTED') {
                        return errorResponse('A relocation is already pending BM approval', 400);
                    }
                    await prisma.client.update({
                        where: { id: client.id },
                        data: {
                            locationApprovalStatus: 'RELOCATION_REQUESTED',
                            pendingLatitude: parsed.newLatitude,
                            pendingLongitude: parsed.newLongitude,
                            relocationRequestedById: user.userId,
                            relocationRequestedAt: now,
                            relocationRemarks: parsed.remarks,
                        },
                    });
                    return successResponse({ status: 'RELOCATION_REQUESTED' }, 'Relocation request submitted');
                }

                // ── BM: Approve the relocation request ─────────────────────────────────────
                case 'approve_relocation': {
                    if (!['BRANCH_MANAGER', 'ADMIN'].includes(user.role)) {
                        return errorResponse('Only Branch Manager can approve relocation', 403);
                    }
                    if (client.locationApprovalStatus !== 'RELOCATION_REQUESTED') {
                        return errorResponse('No pending relocation request found', 400);
                    }
                    if (client.pendingLatitude == null || client.pendingLongitude == null) {
                        return errorResponse('No pending coordinates to approve', 400);
                    }
                    if (!client.centerId) {
                        return errorResponse('Please assign a center to this client before approving location.', 400);
                    }
                    {
                        const distM = await centerDistanceMeters(client.pendingLatitude, client.pendingLongitude);
                        if (distM != null && distM > CENTER_MATCH_RADIUS_METERS) {
                            return errorResponse(
                                `Client location is ${formatMeters(distM)} from the assigned center — exceeds the ${formatMeters(CENTER_MATCH_RADIUS_METERS)} limit.`,
                                400
                            );
                        }
                    }
                    {
                        const visitDistM = await fdoMatchDistanceMeters(client.pendingLatitude, client.pendingLongitude, parsed.bmLatitude, parsed.bmLongitude);
                        if (visitDistM != null && !isLocationMatch(visitDistM, parsed.bmAccuracy)) {
                            return errorResponse(
                                `Your GPS location is ${formatMeters(visitDistM)} from the FDO-requested relocation coordinates — exceeds the ${formatMeters(LOCATION_MATCH_RADIUS_METERS)} match limit.`,
                                400
                            );
                        }
                    }
                    await prisma.client.update({
                        where: { id: client.id },
                        data: {
                            // Promote pending coords to actual coords
                            latitude: client.pendingLatitude,
                            longitude: client.pendingLongitude,
                            pendingLatitude: null,
                            pendingLongitude: null,
                            locationApprovalStatus: 'APPROVED',
                            locationApprovedById: user.userId,
                            locationApprovedAt: now,
                            locationApprovalRemarks: parsed.remarks ?? null,
                            bmVisitLatitude: parsed.bmLatitude,
                            bmVisitLongitude: parsed.bmLongitude,
                            relocationRequestedById: null,
                            relocationRequestedAt: null,
                            relocationRemarks: null,
                        },
                    });
                    return successResponse({ status: 'APPROVED' }, 'Relocation approved — location updated');
                }

                // ── BM: Reject the relocation request ──────────────────────────────────────
                case 'reject_relocation': {
                    if (!['BRANCH_MANAGER', 'ADMIN'].includes(user.role)) {
                        return errorResponse('Only Branch Manager can reject relocation', 403);
                    }
                    if (client.locationApprovalStatus !== 'RELOCATION_REQUESTED') {
                        return errorResponse('No pending relocation request found', 400);
                    }
                    await prisma.client.update({
                        where: { id: client.id },
                        data: {
                            // Clear pending, revert to previous approval state
                            locationApprovalStatus: 'APPROVED',
                            pendingLatitude: null,
                            pendingLongitude: null,
                            locationApprovalRemarks: parsed.remarks,
                            relocationRequestedById: null,
                            relocationRequestedAt: null,
                            relocationRemarks: null,
                        },
                    });
                    return successResponse({ status: 'APPROVED' }, 'Relocation request rejected');
                }
            }
        } catch (error: any) {
            if (error?.name === 'ZodError') return errorResponse(error.errors[0].message, 400);
            console.error('Error updating client location:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to update location', 500);
        }
    })(request);
}
