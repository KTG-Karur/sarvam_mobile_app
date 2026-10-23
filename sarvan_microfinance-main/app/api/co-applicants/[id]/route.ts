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

const updateSchema = z.object({
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

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return withAuth(async (req, user) => {
        try {
            const resolvedParams = await params;
            const { id } = resolvedParams;
            const body = await req.json();
            const parsed = updateSchema.safeParse(body);

            if (!parsed.success) {
                return errorResponse(parsed.error.errors[0]?.message || 'Invalid data', 400);
            }

            const existing = await prisma.coApplicant.findUnique({ where: { id } });
            if (!existing) {
                return errorResponse('Co-applicant not found', 404);
            }

            // INACTIVE co-applicants are historical (superseded by whichever one is
            // ACTIVE now) — editing one instead of creating a fresh co-applicant
            // would rewrite history behind already-issued loan snapshots.
            if (existing.status === 'INACTIVE') {
                return errorResponse('This co-applicant is inactive — create a new co-applicant instead of editing it', 400);
            }

            const data = parsed.data;

            const client = await prisma.client.findUnique({
                where: { id: existing.clientId },
                select: { mobileNumber: true, otherIdNo: true, pancardNo: true, votersIdNo: true },
            });

            const identityChecks: Array<{ field: IdentityField; incoming?: string | null; current?: string | null; clientSide?: string | null; label: string }> = [
                { field: 'MOBILE', incoming: data.mobileNumber, current: existing.mobileNumber, clientSide: client?.mobileNumber, label: 'Mobile Number' },
                { field: 'AADHAAR', incoming: data.otherIdNo, current: existing.otherIdNo, clientSide: client?.otherIdNo, label: 'Aadhaar Number' },
                { field: 'PAN', incoming: data.pancardNo, current: existing.pancardNo, clientSide: client?.pancardNo, label: 'PAN Card Number' },
                { field: 'VOTER_ID', incoming: data.voterIdNo, current: existing.voterIdNo, clientSide: client?.votersIdNo, label: 'Voter ID Number' },
            ];

            for (const check of identityChecks) {
                if (!check.incoming) continue;
                // Only validate values the user actually changed — legacy records can
                // already hold a duplicate, and that must not block editing unrelated
                // fields like gender or economic activity.
                if (valuesMatchAfterNormalization(check.field, check.incoming, check.current)) continue;

                if (valuesMatchAfterNormalization(check.field, check.incoming, check.clientSide)) {
                    return errorResponse(`Client and Co-Applicant cannot use the same ${check.label}.`, 400);
                }

                const result = await checkIdentityUniqueness(check.field, check.incoming, {
                    excludeFamilyClientId: existing.clientId,
                });
                if (result.isDuplicate) {
                    return errorResponse(`${check.label} already exists.`, 409);
                }
            }

            const updated = await prisma.$transaction(async (tx) => {
                const updatedCoApplicant = await tx.coApplicant.update({
                    where: { id },
                    data: {
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
                    },
                });

                await tx.coApplicantHistory.create({
                    data: {
                        coApplicantId: id,
                        action: 'EDITED',
                        performedById: user.userId,
                        remarks: 'Details edited',
                    },
                });

                return updatedCoApplicant;
            });

            return successResponse(updated, 'Co-applicant updated successfully');
        } catch (error) {
            console.error('Error updating co-applicant:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to update co-applicant', 500);
        }
    })(request);
}
