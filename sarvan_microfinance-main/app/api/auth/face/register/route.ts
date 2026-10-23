import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    errorResponse,
    successResponse,
    withAuth,
    handleCorsPreflight,
} from '@/app/lib/api-utils';
import { z } from 'zod';
import { uploadObject, downloadObject } from '@/app/lib/storage/gcs-client';

const registerSchema = z.object({
    encryptedTemplate: z.string().min(1),
    hmacSignature: z.string().min(1),
    algorithm: z.string().min(1),
    vectorSize: z.number().int().positive(),
    featureVector: z.array(z.number()).min(1),
    embeddings: z.array(z.array(z.number())).optional(),
    modelName: z.string().optional().default('MobileFaceNet'),
    modelVersion: z.string().optional().default('v1.0'),
    embeddingVersion: z.string().optional().default('128d'),
    livenessVerified: z.boolean().default(false),
    qualityScore: z.number().min(0).max(100),
    capturedAt: z.string().min(1),
    photoBase64: z.string().optional(),
    deviceId: z.string().optional(),
});

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/auth/face/register — return the caller's own active template so the
// app can restore its on-device cache after a reinstall / data clear. The
// server still re-checks every punch in /face/verify.
export async function GET(request: NextRequest) {
    return withAuth(async (_req, user) => {
        try {
            const template = await prisma.faceTemplate.findUnique({
                where: { userId: user.userId },
                select: {
                    isActive: true,
                    featureVector: true,
                    embeddings: true,
                    modelName: true,
                    modelVersion: true,
                    embeddingVersion: true,
                    photoKey: true,
                },
            });
            if (!template || template.isActive === false) {
                return successResponse({ enrolled: false }, 'Face not enrolled.');
            }

            const embeddings = template.embeddings
                ? (template.embeddings as unknown as number[][])
                : [template.featureVector as unknown as number[]];

            let photoBase64: string | undefined;
            if (template.photoKey) {
                try {
                    const photo = await downloadObject(template.photoKey);
                    if (photo) photoBase64 = photo.buffer.toString('base64');
                } catch (e) {
                    console.error('[Face Template] Photo download failed:', e);
                }
            }

            return successResponse(
                {
                    enrolled: true,
                    embeddings,
                    modelName: template.modelName,
                    modelVersion: template.modelVersion,
                    embeddingVersion: template.embeddingVersion,
                    ...(photoBase64 ? { photoBase64 } : {}),
                },
                'Face template fetched.'
            );
        } catch (error: unknown) {
            console.error('[Face Template] Error:', error);
            const message = error instanceof Error ? error.message : 'Failed to fetch face template';
            return errorResponse(message, 500);
        }
    })(request);
}

// POST /api/auth/face/register — enroll (or re-enroll) the caller's own face template.
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const body = await req.json();
            const validation = registerSchema.safeParse(body);
            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }
            const data = validation.data;

            if (data.featureVector.length !== data.vectorSize) {
                return errorResponse('featureVector length does not match vectorSize', 400);
            }

            // Re-registering an existing template requires an approved request.
            // (First-time enrolment has no template yet and is always allowed.)
            const existingTemplate = await prisma.faceTemplate.findUnique({
                where: { userId: user.userId },
                select: { id: true },
            });
            let approvedReReg: { id: string } | null = null;
            if (existingTemplate) {
                approvedReReg = await prisma.faceReRegistrationRequest.findFirst({
                    where: { userId: user.userId, status: 'APPROVED' },
                    orderBy: { createdAt: 'desc' },
                    select: { id: true },
                });
                if (!approvedReReg) {
                    return errorResponse(
                        'Face re-registration requires administrator approval. Submit a request from the app.',
                        403
                    );
                }
            }

            // Standardize embeddings array: if multi-embeddings are provided, use them;
            // otherwise store single featureVector inside embeddings array.
            const embeddingsList = (data.embeddings && data.embeddings.length > 0)
                ? data.embeddings
                : [data.featureVector];

            let photoKey: string | undefined;
            if (data.photoBase64) {
                const base64Payload = data.photoBase64.replace(/^data:image\/\w+;base64,/, '');
                const buffer = Buffer.from(base64Payload, 'base64');
                photoKey = `face-templates/${user.userId}/${Date.now()}.jpg`;
                await uploadObject(photoKey, buffer, 'image/jpeg');
            }

            const capturedAt = new Date(data.capturedAt);
            if (isNaN(capturedAt.getTime())) {
                return errorResponse('Invalid capturedAt timestamp', 400);
            }

            const template = await prisma.faceTemplate.upsert({
                where: { userId: user.userId },
                create: {
                    userId: user.userId,
                    encryptedTemplate: data.encryptedTemplate,
                    hmacSignature: data.hmacSignature,
                    algorithm: data.algorithm,
                    vectorSize: data.vectorSize,
                    featureVector: data.featureVector,
                    embeddings: embeddingsList,
                    modelName: data.modelName,
                    modelVersion: data.modelVersion,
                    embeddingVersion: data.embeddingVersion,
                    qualityScore: data.qualityScore,
                    livenessVerified: data.livenessVerified,
                    photoKey,
                    deviceId: data.deviceId,
                    capturedAt,
                    isActive: true,
                },
                update: {
                    encryptedTemplate: data.encryptedTemplate,
                    hmacSignature: data.hmacSignature,
                    algorithm: data.algorithm,
                    vectorSize: data.vectorSize,
                    featureVector: data.featureVector,
                    embeddings: embeddingsList,
                    modelName: data.modelName,
                    modelVersion: data.modelVersion,
                    embeddingVersion: data.embeddingVersion,
                    qualityScore: data.qualityScore,
                    livenessVerified: data.livenessVerified,
                    // Only overwrite the stored photo if a new one was captured this time.
                    ...(photoKey ? { photoKey } : {}),
                    deviceId: data.deviceId,
                    capturedAt,
                    isActive: true,
                },
            });

            // Consume the approval so the next re-registration needs a fresh one.
            if (approvedReReg) {
                await prisma.faceReRegistrationRequest.updateMany({
                    where: { userId: user.userId, status: 'APPROVED' },
                    data: { status: 'COMPLETED', completedAt: new Date() },
                });
            }

            return successResponse(
                {
                    templateId: template.id,
                    qualityScore: template.qualityScore,
                    sampleCount: embeddingsList.length,
                    modelVersion: template.modelVersion
                },
                'Face biometric registered successfully with multiple pose embeddings.'
            );
        } catch (error: unknown) {
            console.error('[Face Register] Error:', error);
            const message = error instanceof Error ? error.message : 'Failed to register face template';
            return errorResponse(message, 500);
        }
    })(request);
}

export async function DELETE(request: NextRequest) {
    return withAuth(async (_req, user) => {
        try {
            await Promise.all([
                prisma.faceTemplate.deleteMany({
                    where: { userId: user.userId },
                }),
                prisma.attendance.deleteMany({
                    where: { userId: user.userId },
                }),
                prisma.faceVerificationLog.deleteMany({
                    where: { userId: user.userId },
                }),
            ]);

            return successResponse({}, 'Face biometric template and today attendance records cleared successfully.');
        } catch (error: unknown) {
            console.error('[Face Delete] Error:', error);
            const message = error instanceof Error ? error.message : 'Failed to clear face biometric & attendance data';
            return errorResponse(message, 500);
        }
    })(request);
}
