import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { withRole, errorResponse, successResponse } from '@/app/lib/api-utils';
import { ClientVerificationStatus } from '@prisma/client';
import { moveKycDocumentToVerified } from '@/app/lib/storage/kyc-storage';

/**
 * Validation schema for KYC verification update
 */
const kycVerificationSchema = z.object({
    verifyStatus: z.enum(['verified', 'pending', 'rejected', 'under_review'], {
        errorMap: () => ({ message: 'Invalid verification status. Must be: verified, pending, rejected, or under_review' }),
    }),
    rejectionReason: z.string().optional(),
});

function mapVerifyStatusToEnum(status: string): ClientVerificationStatus {
    const mapping: Record<string, ClientVerificationStatus> = {
        'verified': 'VERIFIED',
        'pending': 'PENDING_VERIFICATION',
        'rejected': 'REJECTED',
        'under_review': 'UNDER_REVIEW',
    };
    return mapping[status] || 'PENDING_VERIFICATION';
}

/**
 * PATCH /api/clients/[clientId]/kyc-verification
 * Update client KYC verification status (Branch Manager and Area Manager only)
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;
    
    return withRole(['BRANCH_MANAGER', 'AREA_MANAGER'], async (req, user) => {
        try {
            const body = await req.json();

            // Validate request body
            const validationResult = kycVerificationSchema.safeParse(body);
            if (!validationResult.success) {
                return errorResponse(
                    validationResult.error.errors[0]?.message || 'Invalid request data',
                    400
                );
            }

            const { verifyStatus, rejectionReason } = validationResult.data;

            // Check if client exists
            const existingClient = await prisma.client.findUnique({
                where: { id: clientId },
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    verificationStatus: true,
                    rejectionReason: true,
                    centerId: true,
                    center: {
                        select: {
                            branchId: true,
                        },
                    },
                    enrolledBy: { select: { branchId: true } },
                },
            });

            if (!existingClient) {
                return errorResponse('Client not found', 404);
            }

            // Branch Managers can only verify clients from their branch
            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                if (!userRecord || !userRecord.branchId) {
                    return errorResponse('User branch not found', 403);
                }

                if ((existingClient.center?.branchId ?? existingClient.enrolledBy?.branchId) !== userRecord.branchId) {
                    return errorResponse('Insufficient permissions: Client is not in your branch', 403);
                }
            }

            const verificationStatusEnum = mapVerifyStatusToEnum(verifyStatus);
            const now = new Date();
            const updateData: any = {};

            if (user.role === 'BRANCH_MANAGER') {
                updateData.verificationStatus =
                    verificationStatusEnum === 'VERIFIED'
                        ? 'UNDER_REVIEW'
                        : verificationStatusEnum;
                updateData.rejectionReason =
                    verificationStatusEnum === 'REJECTED'
                        ? (rejectionReason || 'Client KYC rejected by Branch Manager')
                        : null;
                updateData.verifiedById = null;
                updateData.verifiedAt = null;
            } else if (user.role === 'AREA_MANAGER') {
                if (existingClient.verificationStatus !== 'UNDER_REVIEW') {
                    return errorResponse('Branch Manager verification must be completed before Area Manager approval', 400);
                }
                updateData.verificationStatus = verificationStatusEnum;
                updateData.rejectionReason =
                    verificationStatusEnum === 'REJECTED'
                        ? (rejectionReason || 'Client KYC rejected by Area Manager')
                        : null;
                updateData.verifiedById = verificationStatusEnum === 'VERIFIED' ? user.userId : null;
                updateData.verifiedAt = verificationStatusEnum === 'VERIFIED' ? now : null;
            }

            // Update client verification status
            const updatedClient = await prisma.client.update({
                where: { id: clientId },
                data: updateData,
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    verificationStatus: true,
                    verifiedById: true,
                    verifiedAt: true,
                    rejectionReason: true,
                    verifiedBy: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            role: true,
                        },
                    },
                },
            });

            // If client is verified, move Aadhaar documents to verified folder
            if (updateData.verificationStatus === 'VERIFIED') {
                try {
                    // Get all KYC documents for this client
                    const kycDocuments = await prisma.kYC.findMany({
                        where: {
                            clientId: clientId,
                        },
                        select: {
                            id: true,
                            fileUrl: true,
                        },
                    });

                    // Move each document to verified folder and update DB
                    for (const doc of kycDocuments) {
                        if (doc.fileUrl && doc.fileUrl.includes('/kyc/') && !doc.fileUrl.includes('/verified/')) {
                            try {
                                // Extract file key from URL
                                let fileKey = '';
                                const urlMatch = doc.fileUrl.match(/\/object\/public\/[^\/]+\/(.+)$/);
                                if (urlMatch) {
                                    fileKey = decodeURIComponent(urlMatch[1]);
                                }

                                if (fileKey && !fileKey.includes('/verified/')) {
                                    const newUrl = await moveKycDocumentToVerified(fileKey);
                                    
                                    // Update database with new URL
                                    await prisma.kYC.update({
                                        where: { id: doc.id },
                                        data: {
                                            fileUrl: newUrl,
                                        },
                                    });
                                }
                            } catch (moveError) {
                                // Log error but don't fail the verification
                                console.error(`Error moving KYC document ${doc.id} to verified folder:`, moveError);
                            }
                        }
                    }
                } catch (moveError) {
                    // Log error but don't fail the verification
                    console.error('Error moving KYC documents to verified folder:', moveError);
                }
            }

            return successResponse(
                {
                    client: updatedClient,
                    message:
                        user.role === 'BRANCH_MANAGER'
                            ? (updateData.verificationStatus === 'UNDER_REVIEW'
                                ? 'BM verification completed. Client is now pending AM verification.'
                                : `BM KYC status updated to ${verifyStatus}`)
                            : (updateData.verificationStatus === 'VERIFIED'
                                ? 'AM verification completed. Client KYC is fully approved.'
                                : `AM KYC status updated to ${verifyStatus}`),
                },
                'KYC verification status updated successfully'
            );
        } catch (error) {
            console.error('Error updating KYC verification:', error);
            
            // Handle Prisma errors
            if (error instanceof Error) {
                if (error.message.includes('Record to update not found')) {
                    return errorResponse('Client not found', 404);
                }
                return errorResponse(error.message, 500);
            }
            
            return errorResponse('Failed to update KYC verification status', 500);
        }
    })(request);
}

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
    });
}

