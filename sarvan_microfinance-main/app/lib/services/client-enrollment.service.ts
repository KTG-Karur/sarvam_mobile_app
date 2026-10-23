import { prisma } from '@/app/lib/prisma';
import type { ClientEnrollmentData } from '@/app/lib/validations/client-enrollment.validation';
import { Decimal } from '@prisma/client/runtime/library';
import { accountingPostingService } from '@/app/lib/services/accounting-posting.service';
import { checkIdentityUniqueness, type UniquenessMatch } from '@/app/lib/services/identity-uniqueness.service';
import { highmarkService } from '@/app/lib/services/highmark.service';
import { assertFdoOwnsCenter } from '@/app/lib/filters/fdo-center-scope';

/**
 * Service for handling client enrollment operations
 */
export class ClientEnrollmentService {
    private parseDate(v: unknown): Date | null {
        if (!v || v === '') return null;
        if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
        const s = String(v).trim();
        const dmyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
        if (dmyMatch) {
            const day = parseInt(dmyMatch[1], 10);
            const month = parseInt(dmyMatch[2], 10);
            const year = parseInt(dmyMatch[3], 10);
            const d = new Date(Date.UTC(year, month - 1, day));
            return isNaN(d.getTime()) ? null : d;
        }
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }

    /**
     * Next sequence number for a "{branchCode}-{centerCode}-{groupCode}" clientId
     * prefix: one past the highest numeric suffix among ALL clients whose
     * (globally unique) clientId currently starts with that prefix.
     *
     * Not a count() of current members: clientId is only reassigned when a
     * client is later moved (transfer/center-group-assign), so if a member
     * who isn't the most-recently-added one leaves this combo, count()
     * undercounts while a higher-numbered id is still held by a remaining
     * member — count()+1 then collides with it. Max+1 never does.
     * Mirrors nextClientSequenceForPrefix in group-assignment.service.ts.
     */
    private async nextClientSequenceForPrefix(prefix: string): Promise<number> {
        const matches = await prisma.client.findMany({
            where: { clientId: { startsWith: `${prefix}-` } },
            select: { clientId: true },
        });
        let max = 0;
        for (const { clientId } of matches) {
            const suffix = clientId.slice(prefix.length + 1);
            const n = parseInt(suffix, 10);
            if (!isNaN(n) && n > max) max = n;
        }
        return max + 1;
    }

    /**
     * Generate unique client ID.
     * Format: {branchCode}-{centerCode}-{groupCode}-{seqNo}
     * Placeholder '0' used for unassigned center or group.
     *
     * branchCode is derived from the REQUESTED center's own branch (the Center
     * selected in the Loan Details tab), never from the enroller's own branch —
     * an HO Admin enrolling into a Branch-004 center must get a Branch-004
     * prefix, not HO's. Mirrors the same center.branchId -> Branch.code lookup
     * already used when a BM later assigns a real center
     * (see center-group-assign/route.ts).
     */
    private async generateClientId(centerId: string | null | undefined, requestedCenterBranchId: string | null | undefined): Promise<string> {
        const requestedBranch = requestedCenterBranchId
            ? await prisma.branch.findUnique({
                  where: { id: requestedCenterBranchId },
                  select: { code: true },
              })
            : null;
        const branchCode = requestedBranch?.code ?? '0';

        if (centerId) {
            const center = await prisma.center.findUnique({
                where: { id: centerId },
                select: { code: true },
            });
            if (!center) throw new Error('Center not found');
            const centerCode = center.code ?? '0';

            const seq = await this.nextClientSequenceForPrefix(`${branchCode}-${centerCode}-0`);
            return `${branchCode}-${centerCode}-0-${seq}`;
        }

        // No center yet — use 0 placeholders for both center and group
        const seq = await this.nextClientSequenceForPrefix(`${branchCode}-0-0`);
        return `${branchCode}-0-0-${seq}`;
    }

    /**
     * Create a new client enrollment
     */
    async createEnrollment(
        data: ClientEnrollmentData,
        enrolledById: string,
        additionalDocuments?: Array<{ documentType: string; fileUrl: string; fileName: string }>,
        actor?: { role: string; branchId?: string | null }
    ): Promise<{ success: boolean; clientId?: string; error?: string }> {
        try {
            // If centerId is provided, validate that center exists and is approved
            if (data.client.centerId) {
                const center = await prisma.center.findUnique({
                    where: { id: data.client.centerId },
                    select: { id: true, status: true },
                });

                if (!center) {
                    return { success: false, error: 'Center not found' };
                }

                if (center.status !== 'APPROVED') {
                    return { success: false, error: 'Center is not approved yet' };
                }
            }

            // Group request (FDO's preference) — validate the requested center is
            // approved and owned by this FDO, and the requested group belongs to it.
            const requestedCenter = await prisma.center.findUnique({
                where: { id: data.client.requestedCenterId },
                select: { id: true, name: true, status: true, fdoId: true, branchId: true },
            });
            if (!requestedCenter) {
                return { success: false, error: 'Requested center not found' };
            }
            if (requestedCenter.status !== 'APPROVED') {
                return { success: false, error: 'Requested center is not approved yet' };
            }
            // FDO must own the requested center; Admin/Sub Admin (any non-FDO role)
            // are exempt — they're enrolling on behalf of an FDO, not as one.
            // No actor passed (defensive default) falls back to the strictest
            // behavior, same as before this bypass existed.
            const actingAsRole = actor?.role ?? 'FDO';
            if (!assertFdoOwnsCenter({ userId: enrolledById, role: actingAsRole }, requestedCenter)) {
                return { success: false, error: 'You do not have access to this center' };
            }

            // Defense-in-depth: ADMIN/AREA_MANAGER must have an active branch selected
            // (ClientEnrollmentForm's branch-first selector) matching the requested
            // center's actual branch — prevents enrolling into another branch's center
            // while operating as a different (e.g. HO) branch. FDO/BRANCH_MANAGER are
            // exempt: their branch is fixed to their home branch and already governed
            // by assertFdoOwnsCenter / center ownership above.
            if ((actingAsRole === 'ADMIN' || actingAsRole === 'AREA_MANAGER') && actor?.branchId) {
                if (requestedCenter.branchId !== actor.branchId) {
                    return { success: false, error: 'Selected center does not belong to your active branch' };
                }
            }

            const requestedGroup = await prisma.group.findUnique({
                where: { id: data.client.requestedGroupId },
                select: {
                    id: true,
                    name: true,
                    centerId: true,
                    isActive: true,
                    _count: { select: { members: { where: { client: { isActive: true } } } } },
                },
            });
            if (!requestedGroup || requestedGroup.centerId !== requestedCenter.id) {
                return { success: false, error: 'Requested group does not belong to the requested center' };
            }
            if (!requestedGroup.isActive) {
                return { success: false, error: 'Requested group is not active' };
            }
            // "New Center New Member" must request a brand-new, empty group — not one
            // that already has members from a prior enrollment.
            if (data.client.memberGroupStatus === 'NEW_CENTER_NEW_MEMBER' && requestedGroup._count.members > 0) {
                return { success: false, error: 'Requested group already has members — pick an empty group for a new center/new member request' };
            }
            const requestedCenterName = requestedCenter.name;
            const requestedGroupName = requestedGroup.name;

            const now = new Date();
            const enrollmentRetryWindowMs = 10 * 60 * 1000;

            const isLikelyRetry = (match: UniquenessMatch) =>
                match.source === 'CLIENT' &&
                match.enrolledById === enrolledById &&
                match.verificationStatus === 'PENDING_VERIFICATION' &&
                !!match.createdAt &&
                now.getTime() - match.createdAt.getTime() <= enrollmentRetryWindowMs;

            // Mobile — idempotent retry protection (a resubmission from the same FDO within
            // the retry window returns the existing client instead of erroring)
            const mobileResult = await checkIdentityUniqueness('MOBILE', data.kyc.mobileNumber);
            if (mobileResult.isDuplicate && mobileResult.match) {
                if (isLikelyRetry(mobileResult.match)) {
                    return { success: true, clientId: mobileResult.match.displayClientId };
                }
                return { success: false, error: 'Mobile Number already exists.' };
            }

            // Client Aadhaar — idempotent retry protection
            const aadhaarResult = await checkIdentityUniqueness('AADHAAR', data.kyc.otherIdNo);
            if (aadhaarResult.isDuplicate && aadhaarResult.match) {
                if (isLikelyRetry(aadhaarResult.match)) {
                    return { success: true, clientId: aadhaarResult.match.displayClientId };
                }
                return { success: false, error: 'Aadhaar Number already exists.' };
            }

            // Client PAN / Voter ID / Bank Account — no retry semantics, matches existing
            // scope of the idempotent-retry UX (mobile/aadhaar only)
            const clientOnlyChecks: Array<{
                field: 'PAN' | 'VOTER_ID' | 'BANK_ACCOUNT';
                value?: string;
                label: string;
            }> = [
                { field: 'PAN', value: data.kyc.pancardNo, label: 'PAN Card Number' },
                { field: 'VOTER_ID', value: data.kyc.votersIdNo, label: 'Voter ID Number' },
                { field: 'BANK_ACCOUNT', value: data.client.bankAcNo, label: 'Bank Account Number' },
            ];
            for (const check of clientOnlyChecks) {
                const result = await checkIdentityUniqueness(check.field, check.value);
                if (result.isDuplicate) {
                    return { success: false, error: `${check.label} already exists.` };
                }
            }

            // Co-applicant side — mobile / aadhaar / pan / voterId
            const coApplicantChecks: Array<{
                field: 'MOBILE' | 'AADHAAR' | 'PAN' | 'VOTER_ID';
                value?: string;
                label: string;
            }> = [
                { field: 'MOBILE', value: data.nominee.nomineePhoneNumber, label: 'Co-Applicant Mobile Number' },
                { field: 'AADHAAR', value: data.kyc.caOtherIdNo, label: 'Co-Applicant Aadhaar Number' },
                { field: 'PAN', value: data.kyc.caPancardNo, label: 'Co-Applicant PAN Card Number' },
                { field: 'VOTER_ID', value: data.kyc.caVoterIdNo, label: 'Co-Applicant Voter ID Number' },
            ];
            for (const check of coApplicantChecks) {
                const result = await checkIdentityUniqueness(check.field, check.value);
                if (result.isDuplicate) {
                    return { success: false, error: `${check.label} already exists.` };
                }
            }

            // Generate unique client ID (center-based if centerId provided, branch-based otherwise)
            const clientId = await this.generateClientId(data.client.centerId || null, requestedCenter.branchId);

            // Convert date strings to DateTime objects
            const dateOfBirth = this.parseDate(data.client.dateOfBirth);
            const nomineeDateOfBirth = this.parseDate(data.nominee.nomineeDateOfBirth);

            // Auto-fetch requested amount from selected loan product
            let autoRequestedAmount: Decimal | null = null;
            if (data.nominee.requestedLoanProductId) {
                const loanProduct = await prisma.loanProduct.findUnique({
                    where: { id: data.nominee.requestedLoanProductId },
                    select: { loanAmount: true },
                });
                if (loanProduct) {
                    autoRequestedAmount = new Decimal(loanProduct.loanAmount.toString());
                }
            }

            // Create KYC document records for Aadhaar front/back if provided
            const {
                aadhaarFrontFileUrl,
                aadhaarFrontFileName,
                aadhaarFrontFileSize,
                aadhaarFrontMimeType,
                aadhaarBackFileUrl,
                aadhaarBackFileName,
                aadhaarBackFileSize,
                aadhaarBackMimeType,
            } = data.kyc;

            const client = await prisma.$transaction(async (tx) => {
                // Auto-clean stale DRAFT records before creating the enrolled client.
                // Strategy 1 – exact mobile match (draft saved with correct mobile).
                // Strategy 2 – same FDO + same first+last name (draft saved with a
                //   slightly wrong mobile, e.g. one digit off). Both are safe because:
                //   • Mobile match: can't be a different person.
                //   • Name + FDO match: the same officer won't draft two people with
                //     exactly the same full name at the same time.
                // Find draft IDs to clean up before deleting (FK constraint on kyc_documents)
                const draftsToDelete = await tx.client.findMany({
                    where: {
                        approvalStatus: 'DRAFT' as any,
                        OR: [
                            { mobileNumber: data.kyc.mobileNumber },
                            {
                                enrolledById,
                                firstName: data.client.firstName,
                                lastName: data.client.lastName,
                            },
                        ],
                    },
                    select: { id: true },
                });
                const draftIds = draftsToDelete.map(d => d.id);
                if (draftIds.length > 0) {
                    await tx.kYC.deleteMany({ where: { clientId: { in: draftIds } } });
                    await tx.client.deleteMany({ where: { id: { in: draftIds } } });
                }

                const createdClient = await tx.client.create({
                    data: {
                        clientId,

                        // Basic Information
                        firstName: data.client.firstName,
                        lastName: data.client.lastName,
                        phone: data.client.phone || data.kyc.mobileNumber,
                        email: data.client.email || null,

                        // Center & Group — both deferred; assigned later via Center & Group Assignment
                        centerId: data.client.centerId || null,
                        groupId: data.client.groupId || null,

                        // Group Request — FDO's preference only; BM finalizes via Group Assign
                        memberGroupStatus: data.client.memberGroupStatus,
                        requestedCenterId: data.client.requestedCenterId,
                        requestedCenterName,
                        requestedGroupId: data.client.requestedGroupId,
                        requestedGroupName,
                        requestedByUserId: enrolledById,
                        requestedAt: now,

                        // KYC Information
                        mobileNumber: data.kyc.mobileNumber,
                        votersIdNo: data.kyc.votersIdNo || null,
                        caVoterIdNo: data.kyc.caVoterIdNo || null,
                        otherIdNo: data.kyc.otherIdNo || null,
                        caOtherIdNo: data.kyc.caOtherIdNo || null,
                        pancardNo: data.kyc.pancardNo || null,
                        caPancardNo: data.kyc.caPancardNo || null,
                        smartCardNo: data.kyc.smartCardNo || null,

                        // Address Information
                        permanentAddress: data.client.permanentAddress || null,
                        pincode: data.client.pincode || null,
                        postOffice: data.client.postOffice || null,
                        district: data.client.district || null,
                        state: data.client.state || null,
                        country: data.client.country || 'India',

                        // Personal Details
                        dateOfBirth,
                        age: data.client.age || null,
                        gender: data.client.gender || null,
                        caste: data.client.caste || null,
                        community: data.client.community || null,
                        religion: data.client.religion || null,
                        economicActivityTypeId: data.client.economicActivityTypeId || null,
                        economicActivityId: data.client.economicActivityId || null,
                        qualification: data.client.qualification || null,

                        // Marital & Family Information
                        maritalStatus: data.client.maritalStatus || null,
                        spouseName: data.client.spouseName || null,
                        spouseDob: data.client.spouseDob ? new Date(data.client.spouseDob) : null,
                        spouseMobileNumber: data.client.spouseMobileNumber || null,
                        spouseGender: data.client.spouseGender || null,
                        spouseEconomicActivityTypeId: data.client.spouseEconomicActivityTypeId || null,
                        spouseEconomicActivityId: data.client.spouseEconomicActivityId || null,
                        fatherName: data.client.fatherName || null,
                        motherName: data.client.motherName || null,
                        noOfChildren: data.client.noOfChildren || null,

                        // Financial Information
                        monthlyFamilyIncome: data.client.monthlyFamilyIncome
                            ? new Decimal(data.client.monthlyFamilyIncome)
                            : null,
                        monthlyFamilyExpense: data.client.monthlyFamilyExpense
                            ? new Decimal(data.client.monthlyFamilyExpense)
                            : null,

                        // Banking Details
                        ifscCode: data.client.ifscCode || null,
                        bankAcNo: data.client.bankAcNo || null,
                        bankAccountType: data.client.bankAccountType || null,
                        bankName: data.client.bankName || null,
                        bankBranch: data.client.bankBranch || null,

                        // Other Details
                        houseStatus: data.client.houseStatus || null,

                        // Location
                        latitude: data.client.latitude ? parseFloat(data.client.latitude) : null,
                        longitude: data.client.longitude ? parseFloat(data.client.longitude) : null,

                        // Nominee Information
                        nomineeName: data.nominee.nomineeName || null,
                        nomineePhone: data.nominee.nomineePhoneNumber || null,
                        nomineeGender: data.nominee.nomineeGender || null,
                        nomineeDateOfBirth,
                        nomineeAge: data.nominee.nomineeAge || null,
                        nomineeRelation: data.nominee.nomineeRelation || null,
                        // Loan product selection
                        requestedLoanProductTypeId: data.nominee.requestedLoanProductTypeId || null,
                        requestedLoanFrequency: data.nominee.requestedLoanFrequency || null,
                        requestedLoanProductId: data.nominee.requestedLoanProductId || null,
                        requestedLoanPurposeTypeId: data.nominee.requestedLoanPurposeTypeId || null,
                        requestedLoanPurposeId: data.nominee.requestedLoanPurposeId || null,
                        requestedAmount: autoRequestedAmount,
                        admissionFees: data.nominee.admissionFees
                            ? new Decimal(data.nominee.admissionFees)
                            : null,

                        // Verification & Status
                        // Explicitly set SUBMITTED so the client enters the BM approval
                        // queue. Without this, DRAFT (the first enum value) would be used
                        // as the DB default since we prepended it to the enum.
                        approvalStatus: 'SUBMITTED' as any,
                        verificationStatus: 'PENDING_VERIFICATION',
                        enrolledById,
                        isActive: true,
                    },
                    select: {
                        id: true,
                        clientId: true,
                        firstName: true,
                        lastName: true,
                        verificationStatus: true,
                        latitude: true,
                        longitude: true,
                    },
                });

                // Only create GroupMember if a groupId was provided during enrollment
                if (data.client.groupId) {
                    await tx.groupMember.create({
                        data: {
                            groupId: data.client.groupId,
                            clientId: createdClient.id,
                            joinedAt: new Date(),
                        },
                    });
                }

                await tx.kYC.createMany({
                    data: [
                        {
                            clientId: createdClient.id,
                            documentType: 'aadhaar_front',
                            documentNumber: null,
                            fileUrl: aadhaarFrontFileUrl,
                            fileName: aadhaarFrontFileName ?? null,
                            fileSize: aadhaarFrontFileSize ?? null,
                            mimeType: aadhaarFrontMimeType ?? null,
                            uploadedById: enrolledById,
                        },
                        {
                            clientId: createdClient.id,
                            documentType: 'aadhaar_back',
                            documentNumber: null,
                            fileUrl: aadhaarBackFileUrl,
                            fileName: aadhaarBackFileName ?? null,
                            fileSize: aadhaarBackFileSize ?? null,
                            mimeType: aadhaarBackMimeType ?? null,
                            uploadedById: enrolledById,
                        },
                    ],
                });

                // CR: Nominee = Co-Applicant unification
                // The nominee entered during enrollment IS the co-applicant.
                // Store in the dedicated CoApplicant table for canonical usage
                // across co-applicant screen, approval workflow, and loan processing.
                if (data.nominee.nomineeName) {
                    // The very first co-applicant for a client is always created here
                    // (at enrollment) and is automatically Primary + Active — it's
                    // reviewed as part of the client's own BM->AM->QC->Admin enrollment
                    // approval, so it doesn't go through the separate co-applicant
                    // approval workflow that applies to additional ones added later
                    // via the Co-Applicant Management page.
                    const createdCoApplicant = await tx.coApplicant.create({
                        data: {
                            clientId: createdClient.id,
                            isPrimary: true,
                            status: 'ACTIVE',
                            currentStage: null,
                            bmDecision: 'APPROVED',
                            amDecision: 'APPROVED',
                            qcDecision: 'APPROVED',
                            adminDecision: 'APPROVED',
                            activatedAt: new Date(),
                            createdById: enrolledById,
                            name: data.nominee.nomineeName.trim(),
                            gender: data.nominee.nomineeGender || 'Other',
                            dateOfBirth: nomineeDateOfBirth || new Date(),
                            age: typeof data.nominee.nomineeAge === 'number'
                                ? data.nominee.nomineeAge
                                : parseInt(String(data.nominee.nomineeAge), 10) || 0,
                            economicActivityTypeId: data.nominee.coApplicantEconomicActivityTypeId || null,
                            economicActivityId: data.nominee.coApplicantEconomicActivityId || null,
                            relationWithClient: data.nominee.nomineeRelation || 'Other',
                            mobileNumber: data.nominee.nomineePhoneNumber || '',
                            voterIdNo: data.kyc.caVoterIdNo || null,
                            otherIdNo: data.kyc.caOtherIdNo || null,
                            pancardNo: data.kyc.caPancardNo || null,
                        },
                    });

                    await tx.coApplicantHistory.create({
                        data: {
                            coApplicantId: createdCoApplicant.id,
                            action: 'CREATED',
                            performedById: enrolledById,
                            remarks: 'Created during client enrollment — Primary co-applicant, approved as part of client onboarding',
                        },
                    });
                }

                // Create KYC records for additional documents uploaded in Step 4
                if (additionalDocuments && additionalDocuments.length > 0) {
                    const docsToCreate = additionalDocuments
                        .filter(doc => doc.fileUrl && doc.documentType)
                        .map(doc => ({
                            clientId: createdClient.id,
                            documentType: doc.documentType,
                            documentNumber: null,
                            fileUrl: doc.fileUrl,
                            fileName: doc.fileName || null,
                            fileSize: null,
                            mimeType: null,
                            uploadedById: enrolledById,
                        }));
                    
                    if (docsToCreate.length > 0) {
                        await tx.kYC.createMany({ data: docsToCreate });
                    }
                }

                // Re-link any Highmark (CRIF) pulls that were run against the draft(s) just
                // deleted above — a credit check during enrollment is tagged with the draft's
                // id (see ClientEnrollmentForm's handleRunCreditCheck), so without this the
                // pull would be orphaned (clientId set to null by the FK's onDelete: SetNull)
                // at the exact moment enrollment completes, making it vanish from any
                // center/client-scoped Highmark Log search even though it's never deleted.
                if (draftIds.length > 0) {
                    await tx.highmarkReport.updateMany({
                        where: { clientId: { in: draftIds } },
                        data: { clientId: createdClient.id },
                    });
                }

                // Also self-heal by Aadhaar (same match `getHistoryForClient` does on view) —
                // covers a credit check run before any draft existed (no draftDbId to match
                // above), including one that errored/was blocked, so it's attached to this
                // client immediately rather than staying orphaned until someone happens to
                // open this client's Highmark tab.
                if (data.kyc.otherIdNo) {
                    await tx.highmarkReport.updateMany({
                        where: { aadhaarHash: highmarkService.hashAadhaar(data.kyc.otherIdNo), clientId: null },
                        data: { clientId: createdClient.id },
                    });
                }

                return createdClient;
            }, {
                maxWait: 10000,
                timeout: 20000,
            });

            // Live Employee Tracking: soft-capture pointer at the moment this
            // member was enrolled, reusing the same GPS just stored on the
            // Client row above — never blocks enrollment itself.
            if (client.latitude != null && client.longitude != null) {
                prisma.employeeTrackingEvent.create({
                    data: {
                        employeeId: enrolledById,
                        eventType: 'MEMBER_ENROLLED',
                        latitude: client.latitude,
                        longitude: client.longitude,
                        clientId: client.id,
                        branchId: requestedCenter.branchId,
                        label: `Enrolled ${client.firstName} ${client.lastName}`,
                    },
                }).catch((err: unknown) => console.error('[Client Enrollment] Failed to record tracking event:', err));
            }

            return {
                success: true,
                clientId: client.clientId,
            };
        } catch (error) {
            console.error('Error creating client enrollment:', error);

            // Handle unique constraint violations
            if (error instanceof Error && error.message.includes('Unique constraint')) {
                return { success: false, error: 'Client with this information already exists' };
            }

            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to create client enrollment',
            };
        }
    }

    /**
     * Get client enrollment by ID
     */
    async getEnrollmentById(clientId: string) {
        try {
            const client = await prisma.client.findUnique({
                where: { id: clientId },
                include: {
                    center: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                        },
                    },
                    enrolledBy: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                    verifiedBy: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                },
            });

            return { success: true, data: client };
        } catch (error) {
            console.error('Error fetching client enrollment:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch client enrollment',
            };
        }
    }

    /**
     * Get all enrollments for a specific center
     */
    async getEnrollmentsByCenter(centerId: string, includeInactive = false) {
        try {
            const clients = await prisma.client.findMany({
                where: {
                    centerId,
                    ...(includeInactive ? {} : { isActive: true }),
                },
                include: {
                    center: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                        },
                    },
                    enrolledBy: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                        },
                    },
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });

            return { success: true, data: clients };
        } catch (error) {
            console.error('Error fetching center enrollments:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch enrollments',
            };
        }
    }

    /**
     * Get pending enrollments for verification (BM)
     */
    async getPendingEnrollments(branchId?: string) {
        try {
            const clients = await prisma.client.findMany({
                where: {
                    verificationStatus: 'PENDING_VERIFICATION',
                    isActive: true,
                    ...(branchId
                        ? {
                            center: {
                                branchId,
                            },
                        }
                        : {}),
                },
                include: {
                    center: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                            branchId: true,
                        },
                    },
                    enrolledBy: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                },
                orderBy: {
                    createdAt: 'asc',
                },
            });

            return { success: true, data: clients };
        } catch (error) {
            console.error('Error fetching pending enrollments:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch pending enrollments',
            };
        }
    }
}

// Export singleton instance
export const clientEnrollmentService = new ClientEnrollmentService();
