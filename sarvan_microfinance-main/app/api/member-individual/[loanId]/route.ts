import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/member-individual/[loanId]
 * Fetches the Member Individual record for a loan, lazily creating an empty
 * one on first visit. GRT is NOT part of this record — it's satisfied
 * separately by the client belonging to a completed center-wide grtSession
 * (see /api/grt-sessions).
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    return withRole(['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req, user) => {
        try {
            const { loanId } = await params;

            const loan = await prisma.loan.findUnique({
                where: { id: loanId, isActive: true },
                select: {
                    id: true,
                    loanNumber: true,
                    clientId: true,
                    centerId: true,
                    branchId: true,
                    indexId: true,
                    amount: true,
                    appliedAmount: true,
                    indexedAmount: true,
                    interestRate: true,
                    tenureMonths: true,
                    frequency: true,
                    loanProductId: true,
                    disbursementStatus: true,
                    client: { select: { clientId: true, firstName: true, lastName: true, latitude: true, longitude: true } },
                    center: { select: { name: true, code: true, latitude: true, longitude: true, kmFromBranch: true } },
                    branch: { select: { id: true, name: true, latitude: true, longitude: true } },
                    loanProduct: { select: { productName: true } },
                },
            });
            if (!loan) return errorResponse('Loan not found', 404);

            const fdoHouseImage = await prisma.kYC.findFirst({
                where: {
                    clientId: loan.clientId,
                    documentType: { in: ['house_image_1', 'house_image_2', 'house_image_3'] },
                    isDeleted: false,
                    fileUrl: { not: null }
                },
                orderBy: { createdAt: 'desc' },
                select: {
                    fileUrl: true,
                    createdAt: true,
                    uploadedBy: { select: { firstName: true, lastName: true } },
                },
            });

            const photosInclude = {
                orderBy: { createdAt: 'asc' as const },
                include: { uploadedBy: { select: { firstName: true, lastName: true } } },
            };

            let memberIndividual = await prisma.memberIndividual.findUnique({
                where: { loanId },
                include: { photos: photosInclude },
            });

            if (!memberIndividual) {
                memberIndividual = await prisma.memberIndividual.create({
                    data: {
                        loanId,
                        clientId: loan.clientId,
                        centerId: loan.centerId!,
                        branchId: loan.branchId,
                        createdById: user.userId,
                    },
                    include: { photos: photosInclude },
                });
            }

            const completedGrtSession = await prisma.grtSessionClient.findFirst({
                where: { loanId, grtSession: { completedAt: { not: null } } },
                select: {
                    grtSession: {
                        select: {
                            sessionId: true,
                            sessionDate: true,
                            completedAt: true,
                            questionnaire: {
                                select: {
                                    title: true,
                                    questions: {
                                        where: { isActive: true },
                                        orderBy: { priorityOrder: 'asc' },
                                        select: {
                                            id: true, question: true, questionType: true,
                                            choices: { where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true, choice: true } },
                                        },
                                    },
                                },
                            },
                            answers: { select: { questionId: true, answerText: true, answerBool: true, answerChoiceIds: true } },
                            photos: {
                                select: {
                                    id: true, questionId: true, photoUrl: true, notes: true, createdAt: true,
                                    uploadedBy: { select: { firstName: true, lastName: true } },
                                },
                            },
                        },
                    },
                },
                orderBy: { grtSession: { sessionDate: 'desc' } },
            });

            return successResponse({
                id: memberIndividual.id,
                loan: {
                    id: loan.id,
                    loanNumber: loan.loanNumber,
                    amount: Number(loan.amount),
                    maxAllowedAmount: Number(loan.indexedAmount ?? loan.appliedAmount ?? loan.amount),
                    interestRate: Number(loan.interestRate),
                    tenureMonths: loan.tenureMonths,
                    frequency: loan.frequency,
                    loanProductId: loan.loanProductId,
                    productName: loan.loanProduct?.productName ?? null,
                    disbursementStatus: loan.disbursementStatus,
                    clientName: `${loan.client.firstName} ${loan.client.lastName}`.trim(),
                    clientDisplayId: loan.client.clientId,
                    branchId: loan.branchId,
                    indexId: loan.indexId,
                },
                center: {
                    id: loan.centerId,
                    branchId: loan.branchId,
                    name: loan.center?.name ?? null,
                    code: loan.center?.code ?? null,
                    latitude: loan.center?.latitude ?? null,
                    longitude: loan.center?.longitude ?? null,
                    kmFromBranch: loan.center?.kmFromBranch ?? null,
                },
                branch: {
                    id: loan.branchId,
                    name: loan.branch?.name ?? null,
                    latitude: loan.branch?.latitude ?? null,
                    longitude: loan.branch?.longitude ?? null,
                },
                client: {
                    latitude: loan.client.latitude ?? null,
                    longitude: loan.client.longitude ?? null,
                },
                cashFlow: {
                    foodExpense: memberIndividual.foodExpense != null ? Number(memberIndividual.foodExpense) : null,
                    medicalExpense: memberIndividual.medicalExpense != null ? Number(memberIndividual.medicalExpense) : null,
                    cookingFuelExpense: memberIndividual.cookingFuelExpense != null ? Number(memberIndividual.cookingFuelExpense) : null,
                    electricityExpense: memberIndividual.electricityExpense != null ? Number(memberIndividual.electricityExpense) : null,
                    transportExpense: memberIndividual.transportExpense != null ? Number(memberIndividual.transportExpense) : null,
                    waterExpense: memberIndividual.waterExpense != null ? Number(memberIndividual.waterExpense) : null,
                    educationalExpense: memberIndividual.educationalExpense != null ? Number(memberIndividual.educationalExpense) : null,
                    monthlyExpense: memberIndividual.monthlyExpense != null ? Number(memberIndividual.monthlyExpense) : null,
                    completedAt: memberIndividual.cashFlowCompletedAt,
                },
                loanAppraisal: {
                    reviewedAt: memberIndividual.loanAppraisalReviewedAt,
                },
                houseHoldVisit: {
                    latitude: memberIndividual.visitLatitude,
                    longitude: memberIndividual.visitLongitude,
                    distanceMeters: memberIndividual.visitDistanceMeters,
                    distanceFromClientMeters: memberIndividual.visitDistanceFromClientMeters,
                    distanceFromBranchMeters: memberIndividual.visitDistanceFromBranchMeters,
                    completedAt: memberIndividual.houseHoldVisitCompletedAt,
                    fdoHouseImage: fdoHouseImage ? {
                        photoUrl: fdoHouseImage.fileUrl,
                        uploadedByName: fdoHouseImage.uploadedBy ? `${fdoHouseImage.uploadedBy.firstName ?? ''} ${fdoHouseImage.uploadedBy.lastName ?? ''}`.trim() : 'FDO',
                        createdAt: fdoHouseImage.createdAt,
                    } : null,
                    photos: memberIndividual.photos.map((p) => ({
                        id: p.id, photoUrl: p.photoUrl, isMandatory: p.isMandatory,
                        latitude: p.latitude, longitude: p.longitude,
                        distanceMeters: p.distanceMeters, distanceFromClientMeters: p.distanceFromClientMeters,
                        distanceFromBranchMeters: p.distanceFromBranchMeters,
                        notes: p.notes, createdAt: p.createdAt,
                        uploadedByName: p.uploadedBy ? `${p.uploadedBy.firstName ?? ''} ${p.uploadedBy.lastName ?? ''}`.trim() : 'FDO',
                    })),
                },
                grt: {
                    completedSessionId: completedGrtSession?.grtSession.sessionId ?? null,
                    completedAt: completedGrtSession?.grtSession.completedAt ?? null,
                    questionnaireTitle: completedGrtSession?.grtSession.questionnaire.title ?? null,
                    questions: completedGrtSession
                        ? completedGrtSession.grtSession.questionnaire.questions.map((q) => {
                            const answer = completedGrtSession.grtSession.answers.find((a) => a.questionId === q.id);
                            const photos = completedGrtSession.grtSession.photos.filter((p) => p.questionId === q.id);
                            return {
                                id: q.id,
                                question: q.question,
                                questionType: q.questionType,
                                choices: q.choices,
                                answerText: answer?.answerText ?? null,
                                answerBool: answer?.answerBool ?? null,
                                answerChoiceIds: answer?.answerChoiceIds ?? [],
                                photos: photos.map((p) => ({
                                    id: p.id, photoUrl: p.photoUrl, notes: p.notes, createdAt: p.createdAt,
                                    uploadedByName: p.uploadedBy ? `${p.uploadedBy.firstName ?? ''} ${p.uploadedBy.lastName ?? ''}`.trim() : 'FDO',
                                })),
                            };
                        })
                        : [],
                    // Center-wise photos not tied to any specific question
                    sessionPhotos: completedGrtSession
                        ? completedGrtSession.grtSession.photos
                            .filter((p) => !p.questionId)
                            .map((p) => ({
                                id: p.id, photoUrl: p.photoUrl, notes: p.notes, createdAt: p.createdAt,
                                uploadedByName: p.uploadedBy ? `${p.uploadedBy.firstName ?? ''} ${p.uploadedBy.lastName ?? ''}`.trim() : 'FDO',
                            }))
                        : [],
                },
                isComplete: !!(
                    memberIndividual.cashFlowCompletedAt &&
                    memberIndividual.loanAppraisalReviewedAt &&
                    memberIndividual.houseHoldVisitCompletedAt &&
                    completedGrtSession
                ),
            }, 'Member Individual retrieved successfully');
        } catch (error: any) {
            console.error('Error fetching Member Individual:', error);
            return errorResponse(error.message || 'Failed to fetch Member Individual', 500);
        }
    })(request);
}
