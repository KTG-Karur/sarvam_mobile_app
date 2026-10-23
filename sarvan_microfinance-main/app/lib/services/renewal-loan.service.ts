import { prisma } from '@/app/lib/prisma';
import { Decimal } from '@prisma/client/runtime/library';
import type { ClientApprovalStatus, Prisma } from '@prisma/client';
import { getActiveWorkflowConfig, getPendingStatusForStage } from '@/app/lib/workflow-config';
import { moveKycDocumentToVerified, extractFileKeyFromUrl } from '@/app/lib/storage/kyc-storage';

/**
 * Renewal-loan applications are created from the Member Enrollment page's
 * "Renewal Loan" mode. Unlike a plain `POST /api/loans` renewal (which lands
 * straight in Loan Indexation), these pass the same FDO -> BM -> AM -> QC ->
 * Admin chain as a new-member enrollment before they become indexable.
 *
 * The chain rides on `Loan.renewalApprovalStatus` (reusing the
 * `ClientApprovalStatus` enum). The member is already APPROVED, so nothing here
 * touches `Client.approvalStatus`. Address / location / co-applicant edits are
 * held on `Loan.renewalProposedData` and applied to the `Client` only at
 * FINAL_APPROVE — a mid-chain retake never mutates the live approved member.
 */

const RESIDENCE_DOC_TYPES = ['house_image_1', 'house_image_2', 'house_image_3', 'location_qr', 'gas_bill', 'noc_image_1', 'noc_image_2', 'noc_image_3'] as const;

export interface RenewalProposedAddress {
    permanentAddress?: string | null;
    pincode?: string | null;
    postOffice?: string | null;
    district?: string | null;
    state?: string | null;
    country?: string | null;
    latitude?: string | null;
    longitude?: string | null;
}

export interface RenewalCoApplicantExisting {
    mode: 'existing';
    coApplicantId: string;
}

export interface RenewalCoApplicantNew {
    mode: 'new';
    name: string;
    gender: string;
    dateOfBirth: string;
    age: number;
    relationWithClient: string;
    mobileNumber: string;
    economicActivityTypeId?: string | null;
    economicActivityId?: string | null;
    voterIdNo?: string | null;
    otherIdNo?: string | null;
    pancardNo?: string | null;
}

export type RenewalCoApplicantInput = RenewalCoApplicantExisting | RenewalCoApplicantNew;

export interface RenewalKycDoc {
    documentType: string;
    fileUrl: string;
    fileName?: string | null;
    documentNumber?: string | null;
}

export interface CreateRenewalApplicationInput {
    clientId: string; // Client.id
    centerId: string;
    // Loan Details tab
    loanProductId: string;
    amount: string;
    interestRate: string;
    tenureMonths: number;
    frequency: string;
    loanPurposeId: string;
    // Proposed (deferred) edits
    proposedAddress: RenewalProposedAddress;
    coApplicant: RenewalCoApplicantInput;
    // KYC re-uploads (files already in storage; we only persist rows)
    houseDocuments: RenewalKycDoc[];
    coApplicantDocuments?: RenewalKycDoc[];
}

function firstPendingStatus(activeStages: { stages: { levelOrder: number; roleSlug: string; stageName: string }[] } | null): ClientApprovalStatus {
    if (activeStages && activeStages.stages.length > 0) {
        return getPendingStatusForStage(activeStages.stages[0]);
    }
    return 'SUBMITTED' as ClientApprovalStatus;
}

async function generateLoanNumber(attempt = 0): Promise<string> {
    const MAX_ATTEMPTS = 5;
    const allLoans = await prisma.loan.findMany({ select: { loanNumber: true } });
    const maxNum = allLoans.reduce((max, l) => {
        if (/^\d+$/.test(l.loanNumber)) {
            const n = parseInt(l.loanNumber, 10);
            return n > max ? n : max;
        }
        return max;
    }, 0);
    const loanNumber = (maxNum + 1).toString().padStart(6, '0');
    const exists = await prisma.loan.findUnique({ where: { loanNumber }, select: { id: true } });
    if (exists) {
        if (attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, Math.random() * 100));
            return generateLoanNumber(attempt + 1);
        }
        throw new Error('Failed to generate unique loan number after multiple attempts');
    }
    return loanNumber;
}

export class RenewalLoanService {
    /**
     * FDO submits a renewal loan from the enrollment page. Creates the Loan
     * (applicationStatus DRAFT so it stays out of Loan Indexation), its
     * loan-scoped KYC rows, an optional new CoApplicant (PENDING_APPROVAL), and
     * the first LoanApprovalHistory entry — all in one transaction.
     */
    async createRenewalApplication(
        input: CreateRenewalApplicationInput,
        fdoUserId: string
    ): Promise<{ success: boolean; loanId?: string; loanNumber?: string; error?: string }> {
        try {
            const client = await prisma.client.findUnique({
                where: { id: input.clientId },
                select: {
                    id: true,
                    clientId: true,
                    centerId: true,
                    isActive: true,
                    isDefaultMember: true,
                    defaultMemberReason: true,
                    approvalStatus: true,
                },
            });
            if (!client) return { success: false, error: 'Member not found' };
            if (!client.isActive) return { success: false, error: 'Member is inactive' };
            if (client.approvalStatus !== 'APPROVED') {
                return { success: false, error: 'Only fully approved members are eligible for a renewal loan' };
            }
            if (client.isDefaultMember) {
                return {
                    success: false,
                    error: client.defaultMemberReason
                        ? `This member is marked as a Default Member and cannot be given a new loan: ${client.defaultMemberReason}`
                        : 'This member is marked as a Default Member and cannot be given a new loan',
                };
            }
            if (client.centerId !== input.centerId) {
                return { success: false, error: 'Selected center does not match the member center' };
            }

            const center = await prisma.center.findUnique({
                where: { id: input.centerId },
                select: { id: true, branchId: true },
            });
            if (!center) return { success: false, error: 'Center not found' };

            // No renewal while another renewal or an unindexed loan is in flight
            const blockingLoan = await prisma.loan.findFirst({
                where: {
                    clientId: client.id,
                    isActive: true,
                    OR: [
                        { renewalApprovalStatus: { notIn: ['APPROVED', 'REJECTED'] as ClientApprovalStatus[] } },
                        {
                            indexId: null,
                            disbursementStatus: { in: ['PENDING_LEVEL1', 'APPROVED_LEVEL1'] },
                            applicationStatus: { in: ['PENDING_VERIFICATION', 'VERIFIED'] },
                        },
                    ],
                },
                select: { id: true, loanNumber: true },
            });
            if (blockingLoan) {
                return {
                    success: false,
                    error: `This member already has a loan application awaiting processing (${blockingLoan.loanNumber}). Complete or delete it first.`,
                };
            }

            const loanProduct = await prisma.loanProduct.findUnique({
                where: { id: input.loanProductId },
                select: { id: true, isActive: true },
            });
            if (!loanProduct || !loanProduct.isActive) {
                return { success: false, error: 'Selected loan product is not available' };
            }
            const loanPurpose = await prisma.loanPurpose.findFirst({
                where: { id: input.loanPurposeId, isActive: true },
                select: { id: true },
            });
            if (!loanPurpose) return { success: false, error: 'Invalid or inactive loan purpose selected' };

            // Resolve co-applicant intent
            const coApplicantMode: 'existing' | 'new' = input.coApplicant.mode;
            let existingCoApplicantId: string | null = null;
            if (input.coApplicant.mode === 'existing') {
                const co = await prisma.coApplicant.findUnique({
                    where: { id: input.coApplicant.coApplicantId },
                    select: { id: true, clientId: true, status: true },
                });
                if (!co || co.clientId !== client.id) {
                    return { success: false, error: 'Selected co-applicant does not belong to this member' };
                }
                if (co.status !== 'APPROVED' && co.status !== 'ACTIVE') {
                    return { success: false, error: 'Selected co-applicant has not completed approval' };
                }
                existingCoApplicantId = co.id;
            }

            const houseDocs = (input.houseDocuments || []).filter(
                (d) => d.fileUrl && (RESIDENCE_DOC_TYPES as readonly string[]).includes(d.documentType)
            );
            if (houseDocs.length === 0) {
                return { success: false, error: 'At least one house image is required for a renewal loan' };
            }

            const wfConfig = await getActiveWorkflowConfig();
            const startStatus = firstPendingStatus(wfConfig);
            const loanNumber = await generateLoanNumber();

            const created = await prisma.$transaction(async (tx) => {
                let newCoApplicantId: string | null = null;
                if (input.coApplicant.mode === 'new') {
                    const nc = input.coApplicant;
                    const createdCo = await tx.coApplicant.create({
                        data: {
                            clientId: client.id,
                            isPrimary: false,
                            status: 'PENDING_APPROVAL',
                            currentStage: 'BM',
                            createdById: fdoUserId,
                            name: nc.name.trim(),
                            gender: nc.gender || 'Other',
                            dateOfBirth: nc.dateOfBirth ? new Date(nc.dateOfBirth) : new Date(),
                            age: Number(nc.age) || 0,
                            economicActivityTypeId: nc.economicActivityTypeId || null,
                            economicActivityId: nc.economicActivityId || null,
                            relationWithClient: nc.relationWithClient || 'Other',
                            mobileNumber: nc.mobileNumber || '',
                            voterIdNo: nc.voterIdNo || null,
                            otherIdNo: nc.otherIdNo || null,
                            pancardNo: nc.pancardNo || null,
                        },
                        select: { id: true },
                    });
                    newCoApplicantId = createdCo.id;
                    await tx.coApplicantHistory.create({
                        data: {
                            coApplicantId: createdCo.id,
                            action: 'CREATED',
                            performedById: fdoUserId,
                            remarks: 'Created during a renewal loan application — reviewed within the renewal approval chain',
                        },
                    });
                }

                const proposedData = {
                    address: {
                        permanentAddress: input.proposedAddress.permanentAddress ?? null,
                        pincode: input.proposedAddress.pincode ?? null,
                        postOffice: input.proposedAddress.postOffice ?? null,
                        district: input.proposedAddress.district ?? null,
                        state: input.proposedAddress.state ?? null,
                        country: input.proposedAddress.country ?? null,
                        latitude: input.proposedAddress.latitude ?? null,
                        longitude: input.proposedAddress.longitude ?? null,
                    },
                    coApplicantMode,
                    coApplicantId: coApplicantMode === 'existing' ? existingCoApplicantId : newCoApplicantId,
                } as Prisma.InputJsonObject;

                const loan = await tx.loan.create({
                    data: {
                        loanNumber,
                        clientId: client.id,
                        centerId: center.id,
                        branchId: center.branchId,
                        loanProductId: input.loanProductId,
                        amount: new Decimal(input.amount),
                        appliedAmount: new Decimal(input.amount),
                        interestRate: new Decimal(input.interestRate),
                        tenureMonths: input.tenureMonths,
                        frequency: input.frequency,
                        loanPurposeId: input.loanPurposeId,
                        createdById: fdoUserId,
                        applicationStatus: 'DRAFT',
                        disbursementStatus: 'PENDING_LEVEL1',
                        isRenewalApplication: true,
                        renewalApprovalStatus: startStatus,
                        renewalProposedData: proposedData,
                    },
                    select: { id: true, loanNumber: true },
                });

                const kycRows: Prisma.KYCCreateManyInput[] = [];
                for (const d of houseDocs) {
                    kycRows.push({
                        clientId: client.id,
                        loanId: loan.id,
                        documentType: d.documentType,
                        documentNumber: d.documentNumber ?? null,
                        fileUrl: d.fileUrl,
                        fileName: d.fileName ?? null,
                        uploadedById: fdoUserId,
                    });
                }
                if (input.coApplicant.mode === 'new' && newCoApplicantId) {
                    for (const d of input.coApplicantDocuments || []) {
                        if (!d.fileUrl) continue;
                        kycRows.push({
                            clientId: client.id,
                            loanId: loan.id,
                            coApplicantId: newCoApplicantId,
                            documentType: d.documentType,
                            documentNumber: d.documentNumber ?? null,
                            fileUrl: d.fileUrl,
                            fileName: d.fileName ?? null,
                            uploadedById: fdoUserId,
                        });
                    }
                }
                if (kycRows.length > 0) {
                    await tx.kYC.createMany({ data: kycRows });
                }

                await tx.loanApprovalHistory.create({
                    data: {
                        loanId: loan.id,
                        action: 'FDO_SUBMITTED_RENEWAL',
                        performedById: fdoUserId,
                        remarks: null,
                        previousState: JSON.stringify({ renewalApprovalStatus: null }),
                        newState: JSON.stringify({ renewalApprovalStatus: startStatus }),
                    },
                });

                return loan;
            }, { maxWait: 10000, timeout: 20000 });

            return { success: true, loanId: created.id, loanNumber: created.loanNumber };
        } catch (error) {
            console.error('Error creating renewal loan application:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to create renewal loan application',
            };
        }
    }

    /**
     * Called from the renewal approval action route on FINAL_APPROVE. Applies
     * the deferred edits to the member, freezes the co-applicant snapshot, moves
     * the renewal KYC files into the verified bucket, and flips the loan into
     * PENDING_VERIFICATION so it appears in Loan Indexation.
     * Runs inside the caller's transaction — pass `tx`.
     */
    async finalizeRenewalApproval(
        tx: Prisma.TransactionClient,
        loanId: string,
        adminUserId: string
    ): Promise<void> {
        const loan = await tx.loan.findUnique({
            where: { id: loanId },
            select: { id: true, clientId: true, renewalProposedData: true },
        });
        if (!loan) throw new Error('Renewal loan not found');

        const proposed = (loan.renewalProposedData ?? {}) as {
            address?: RenewalProposedAddress;
            coApplicantMode?: 'existing' | 'new';
            coApplicantId?: string | null;
        };

        // 1. Apply deferred address / location edits to the member
        const addr = proposed.address ?? {};
        await tx.client.update({
            where: { id: loan.clientId },
            data: {
                permanentAddress: addr.permanentAddress ?? undefined,
                pincode: addr.pincode ?? undefined,
                postOffice: addr.postOffice ?? undefined,
                district: addr.district ?? undefined,
                state: addr.state ?? undefined,
                country: addr.country ?? undefined,
                latitude: addr.latitude ? parseFloat(addr.latitude) : undefined,
                longitude: addr.longitude ? parseFloat(addr.longitude) : undefined,
            },
        });

        // 1b. Promote this renewal's re-uploaded house/NOC/location docs into
        // the member's canonical KYC (loanId: null) — otherwise they stay
        // scoped to this one renewal forever, and every other view of this
        // member (their profile, Search & Locate, a LATER renewal's carried-
        // over KYC) keeps showing the house photo/NOC/location that was on
        // file BEFORE this renewal (or none, if there wasn't one). These
        // already passed the BM->AM->QC review that gated FINAL_APPROVE, so
        // they're created pre-verified. Copied (not moved) so
        // `renewalKycDocuments` above still shows exactly what was submitted
        // for THIS renewal's own audit trail.
        const renewalHouseDocs = await tx.kYC.findMany({
            where: {
                loanId: loan.id,
                isDeleted: false,
                coApplicantId: null,
                documentType: { in: RESIDENCE_DOC_TYPES as unknown as string[] },
                fileUrl: { not: null },
            },
            select: { documentType: true, documentNumber: true, fileUrl: true, fileName: true, mimeType: true, uploadedById: true },
        });
        if (renewalHouseDocs.length > 0) {
            const types = renewalHouseDocs.map((d) => d.documentType);
            // Retire the member's previous canonical copy of these same types —
            // this renewal's version supersedes it.
            await tx.kYC.updateMany({
                where: { clientId: loan.clientId, loanId: null, coApplicantId: null, documentType: { in: types }, isDeleted: false },
                data: { isDeleted: true },
            });
            await tx.kYC.createMany({
                data: renewalHouseDocs.map((d) => ({
                    clientId: loan.clientId,
                    loanId: null,
                    documentType: d.documentType,
                    documentNumber: d.documentNumber,
                    fileUrl: d.fileUrl as string,
                    fileName: d.fileName,
                    mimeType: d.mimeType,
                    uploadedById: d.uploadedById,
                    status: 'VERIFIED',
                    bmDecision: 'VERIFIED',
                    amDecision: 'VERIFIED',
                    qcDecision: 'VERIFIED',
                })),
            });
        }

        // 2. Co-applicant: the renewal-action route's assertCoApplicantReviewed(4)
        // gate already requires a NEW co-applicant to be fully APPROVED (via the
        // normal Co-Applicant Approval queue — the same "BM Approval Page" flow
        // used for enrollment) before FINAL_APPROVE can even be called, so there's
        // nothing left to approve here — just stamp activation and snapshot.
        if (proposed.coApplicantId) {
            if (proposed.coApplicantMode === 'new') {
                await tx.coApplicant.update({
                    where: { id: proposed.coApplicantId },
                    data: {
                        activatedById: adminUserId,
                        activatedAt: new Date(),
                    },
                });
            }
            const co = await tx.coApplicant.findUnique({
                where: { id: proposed.coApplicantId },
                select: {
                    id: true, name: true, gender: true, dateOfBirth: true, age: true,
                    relationWithClient: true, mobileNumber: true, voterIdNo: true,
                    otherIdNo: true, pancardNo: true,
                    economicActivityType: { select: { name: true } },
                    economicActivity: { select: { name: true } },
                },
            });
            if (co) {
                await tx.loanCoApplicantSnapshot.upsert({
                    where: { loanId: loan.id },
                    create: {
                        loanId: loan.id,
                        sourceCoApplicantId: co.id,
                        name: co.name,
                        gender: co.gender,
                        dateOfBirth: co.dateOfBirth,
                        age: co.age,
                        relationWithClient: co.relationWithClient,
                        mobileNumber: co.mobileNumber,
                        voterIdNo: co.voterIdNo,
                        otherIdNo: co.otherIdNo,
                        pancardNo: co.pancardNo,
                        economicActivityTypeName: co.economicActivityType?.name ?? null,
                        economicActivityName: co.economicActivity?.name ?? null,
                        createdById: adminUserId,
                    },
                    update: {},
                });
            }
        }

        // 3. Release the loan into Loan Indexation
        await tx.loan.update({
            where: { id: loan.id },
            data: {
                applicationStatus: 'PENDING_VERIFICATION',
                renewalApprovalStatus: 'APPROVED',
                verifiedById: adminUserId,
                verifiedAt: new Date(),
            },
        });
    }

    /**
     * Moves a finalised renewal's loan-scoped KYC files from the kyc/ bucket to
     * verified/. Call AFTER the approval transaction commits (network I/O must
     * not sit inside a DB transaction) — mirrors the client approval route's
     * post-transaction file move. Best-effort per file.
     */
    async moveRenewalKycToVerified(loanId: string): Promise<void> {
        const kycDocs = await prisma.kYC.findMany({
            where: { loanId, isDeleted: false },
            select: { id: true, clientId: true, fileUrl: true },
        });
        for (const doc of kycDocs) {
            if (doc.fileUrl && doc.fileUrl.includes('/kyc/') && !doc.fileUrl.includes('/verified/')) {
                try {
                    const fileKey = extractFileKeyFromUrl(doc.fileUrl);
                    if (fileKey && !fileKey.includes('/verified/')) {
                        const newUrl = await moveKycDocumentToVerified(fileKey);
                        // Repoint every row sharing this file — not just the loan-scoped
                        // one. finalizeRenewalApproval promotes residence docs into the
                        // member's canonical KYC (loanId: null) with the SAME fileUrl, so
                        // updating only doc.id left those copies pointing at the deleted
                        // pending/ key (broken images on the member's approval/profile).
                        await prisma.kYC.updateMany({
                            where: { clientId: doc.clientId, fileUrl: doc.fileUrl },
                            data: { fileUrl: newUrl },
                        });
                    }
                } catch (moveErr) {
                    console.error(`[moveRenewalKycToVerified] Failed to move doc ${doc.id} for loan ${loanId}:`, moveErr);
                }
            }
        }
    }
}

export const renewalLoanService = new RenewalLoanService();
