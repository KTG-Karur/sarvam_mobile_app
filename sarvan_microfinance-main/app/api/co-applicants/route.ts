import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import {
    checkIdentityUniqueness,
    valuesMatchAfterNormalization,
    type IdentityField,
} from '@/app/lib/services/identity-uniqueness.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const coApplicantInclude = {
    economicActivityType: { select: { id: true, name: true } },
    economicActivity: { select: { id: true, name: true } },
    client: {
        select: {
            id: true,
            clientId: true,
            firstName: true,
            lastName: true,
            createdAt: true,
            center: { select: { id: true, name: true, code: true } },
        },
    },
} as const;

export async function GET(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const clientId = searchParams.get('clientId');
            const all = searchParams.get('all') === 'true';
            const eligible = searchParams.get('eligible') === 'true';

            if (!clientId) {
                return errorResponse('clientId is required', 400);
            }

            if (all || eligible) {
                const coApplicants = await prisma.coApplicant.findMany({
                    where: {
                        clientId,
                        ...(eligible ? { status: { in: ['APPROVED', 'ACTIVE'] } } : {}),
                    },
                    include: coApplicantInclude,
                    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                });
                return successResponse(coApplicants, 'Co-applicants fetched');
            }

            // Default (unchanged from before this feature): the client's single
            // representative co-applicant for client-facing pages — the Primary one.
            let coApplicant = await prisma.coApplicant.findFirst({
                where: { clientId, isPrimary: true },
                include: coApplicantInclude,
            });
            if (!coApplicant) {
                // Fallback for any row that predates the isPrimary backfill.
                coApplicant = await prisma.coApplicant.findFirst({
                    where: { clientId },
                    include: coApplicantInclude,
                    orderBy: { createdAt: 'asc' },
                });
            }

            return successResponse(coApplicant, coApplicant ? 'Co-applicant fetched' : 'No co-applicant found');
        } catch (error) {
            console.error('Error fetching co-applicant:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch co-applicant', 500);
        }
    })(request);
}

const createSchema = z.object({
    clientId: z.string().min(1, 'Client ID is required'),
    name: z.string().min(1, 'Co-applicant name is required'),
    gender: z.string().min(1, 'Gender is required'),
    dateOfBirth: z.string().min(1, 'Date of birth is required'),
    age: z.number().int().min(0),
    economicActivityTypeId: z.string().optional().nullable(),
    economicActivityId: z.string().optional().nullable(),
    relationWithClient: z.string().min(1, 'Relation with client is required'),
    mobileNumber: z.string().regex(/^[0-9]{10}$/, 'Mobile number must be 10 digits'),
    voterIdNo: z.string().optional().nullable(),
    otherIdNo: z.string().optional().nullable(),
    pancardNo: z.string().optional().nullable(),
});

export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const body = await req.json();
            const parsed = createSchema.safeParse(body);

            if (!parsed.success) {
                return errorResponse(parsed.error.errors[0]?.message || 'Invalid data', 400);
            }

            const data = parsed.data;

            const client = await prisma.client.findUnique({
                where: { id: data.clientId },
                select: { id: true, mobileNumber: true, otherIdNo: true, pancardNo: true, votersIdNo: true },
            });
            if (!client) {
                return errorResponse('Client not found', 404);
            }

            const identityChecks: Array<{ field: IdentityField; incoming?: string | null; clientSide?: string | null; label: string }> = [
                { field: 'MOBILE', incoming: data.mobileNumber, clientSide: client.mobileNumber, label: 'Mobile Number' },
                { field: 'AADHAAR', incoming: data.otherIdNo, clientSide: client.otherIdNo, label: 'Aadhaar Number' },
                { field: 'PAN', incoming: data.pancardNo, clientSide: client.pancardNo, label: 'PAN Card Number' },
                { field: 'VOTER_ID', incoming: data.voterIdNo, clientSide: client.votersIdNo, label: 'Voter ID Number' },
            ];

            for (const check of identityChecks) {
                if (!check.incoming) continue;

                if (valuesMatchAfterNormalization(check.field, check.incoming, check.clientSide)) {
                    return errorResponse(`Client and Co-Applicant cannot use the same ${check.label}.`, 400);
                }

                const result = await checkIdentityUniqueness(check.field, check.incoming, {
                    excludeFamilyClientId: data.clientId,
                });
                if (result.isDuplicate) {
                    return errorResponse(`${check.label} already exists.`, 409);
                }
            }

            const coApplicant = await prisma.$transaction(async (tx) => {
                const existingCount = await tx.coApplicant.count({ where: { clientId: data.clientId } });

                const created = await tx.coApplicant.create({
                    data: {
                        clientId: data.clientId,
                        isPrimary: existingCount === 0,
                        name: data.name.trim(),
                        gender: data.gender,
                        dateOfBirth: new Date(data.dateOfBirth),
                        age: data.age,
                        economicActivityTypeId: data.economicActivityTypeId || null,
                        economicActivityId: data.economicActivityId || null,
                        relationWithClient: data.relationWithClient,
                        mobileNumber: data.mobileNumber,
                        voterIdNo: data.voterIdNo?.trim() || null,
                        otherIdNo: data.otherIdNo?.trim() || null,
                        pancardNo: data.pancardNo?.trim().toUpperCase() || null,
                        status: 'PENDING_APPROVAL',
                        currentStage: 'BM',
                        createdById: user.userId,
                    },
                });

                await tx.coApplicantHistory.create({
                    data: {
                        coApplicantId: created.id,
                        action: 'CREATED',
                        performedById: user.userId,
                        remarks: existingCount === 0 ? 'Created as Primary co-applicant' : 'Created as additional co-applicant',
                    },
                });

                return created;
            });

            return successResponse(coApplicant, 'Co-applicant created — pending Branch Manager approval', 201);
        } catch (error) {
            console.error('Error creating co-applicant:', error);
            if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
                return errorResponse('A co-applicant with these details already exists', 409);
            }
            return errorResponse(error instanceof Error ? error.message : 'Failed to create co-applicant', 500);
        }
    })(request);
}
