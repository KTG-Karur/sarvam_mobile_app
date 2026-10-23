import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { hashPassword } from '@/app/lib/auth';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requireAuth, isUserContext } from '@/app/lib/permissions/guards';
import { processStageAction, getWorkflowStatus } from '@/app/lib/approval/engine';
import { hrOnboardingValidationService } from '@/app/lib/services/hr-onboarding-validation.service';
import { resolveEmployeeFolder } from '@/app/lib/storage/gcs-path-resolver';
import { copyObject } from '@/app/lib/storage/gcs-client';
import { syncUserLegacyRoleFromActiveAssignments } from '@/app/lib/rbac-role-sync';
import { invalidateUserPermissions } from '@/app/lib/permissions/engine';
import { checkOnboardingDuplicates, formatInternalDuplicateMessage, type OnboardingRejoinerHint } from '@/app/lib/hr/onboarding-duplicate-check';
import { applyCtcChange } from '@/app/lib/hr/apply-ctc-change';
import { hasUsableOnboardingPhoto } from '@/app/lib/hr/employee-photo';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const actionSchema = z.object({
    action: z.enum(['approve', 'reject', 'send_back']),
    remarks: z.string().optional(),
    // Only relevant — and required — when this Approve completes the FINAL
    // workflow stage (see isFinalStage below). The admin allocates these here
    // instead of at submission time, and types the login credentials by hand
    // instead of them being auto-generated.
    designationId: z.string().optional(),
    departmentId: z.string().optional(),
    reportingManagerId: z.string().optional(),
    dateOfJoining: z.string().optional(), // yyyy-mm-dd from a date input
    employeeId: z.string().optional(),
    password: z.string().optional(),
    monthlyCtc: z.number().min(0).optional(),
    // Extra branches beyond onboardingRequest.branchId (the primary) for
    // ANY role — added as non-primary AreaManagerBranch rows for Area
    // Manager, or UserBranchAssignment rows for everyone else, below.
    additionalBranchIds: z.array(z.string()).optional(),
});

function splitName(fullName: string): { firstName: string; lastName: string } {
    const parts = fullName.trim().split(/\s+/);
    const firstName = parts[0] || fullName;
    const lastName = parts.slice(1).join(' ') || '-';
    return { firstName, lastName };
}

// POST /api/hr/onboarding/[id]/action — advance the request's ApprovalInstance
// via the generic engine, then, once every configured stage has approved it,
// generate the Employee ID + a one-time password and provision the actual
// login. Manual-entry and link-submitted requests both go through this same
// gate — there is no fast path that skips approval for either.
//
// Deliberately gated by requireAuth (any authenticated user), not a fixed
// 'hr-onboarding:approve' RBAC permission — an Admin can put ANY role on any
// stage via Approval Settings, and a static permission grant would silently
// lock out whichever role gets assigned to a stage next unless someone
// remembers to also grant it the RBAC permission. The real, per-stage
// authorization already happens inside processStageAction (it checks the
// actor's role against that specific stage's approverRoleSlug and throws a
// clear error otherwise) — that check is the actual gate here.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requireAuth(request);
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const onboardingRequest = await prisma.employeeOnboardingRequest.findUnique({ where: { id } });
        if (!onboardingRequest) return errorResponse('Onboarding request not found', 404);
        if (!onboardingRequest.approvalInstanceId) {
            return errorResponse('This request has no active approval workflow', 409);
        }
        if (onboardingRequest.createdByUserId === ctx.userId && !ctx.roles.some((r) => r.roleSlug === 'admin')) {
            return errorResponse('You cannot approve a request you created yourself', 400);
        }

        const body = await request.json();
        const { action, remarks, designationId, departmentId, reportingManagerId, dateOfJoining, employeeId, password, additionalBranchIds, monthlyCtc } = actionSchema.parse(body);

        // Determine whether this action targets the FINAL workflow stage —
        // the only one whose Approve can complete the instance and create the
        // login. Computed (and validated) BEFORE calling processStageAction,
        // since that call is not safely retriable: it already advances
        // currentStageId (or completes the instance) as a side effect, so a
        // validation failure afterward would leave an APPROVED instance with
        // no User ever created.
        const workflowStatus = await getWorkflowStatus(onboardingRequest.approvalInstanceId);
        const maxStageOrder = Math.max(...workflowStatus.stages.map((s) => s.stageOrder));
        const currentStage = workflowStatus.stages.find((s) => s.stageId === workflowStatus.instance.currentStageId);
        const isFinalStage = currentStage?.stageOrder === maxStageOrder;

        let dateOfJoiningValue: Date | undefined;
        if (action === 'approve' && isFinalStage) {
            if (!employeeId) return errorResponse('Employee ID is required to finalize approval', 400);
            if (!password) return errorResponse('Password is required to finalize approval', 400);
            if (password.length < 8) return errorResponse('Password must be at least 8 characters', 400);
            if (monthlyCtc === undefined) return errorResponse('Month CTC Pay is required to finalize approval', 400);

            const empIdClash = await prisma.user.findUnique({ where: { employeeId } });
            if (empIdClash) return errorResponse(`Employee ID "${employeeId}" is already in use`, 409);

            dateOfJoiningValue = dateOfJoining ? new Date(dateOfJoining) : undefined;
            const orgValidation = await hrOnboardingValidationService.assertRequiredFieldsPresent([
                { configKey: 'designationId', value: designationId, label: 'Designation' },
                { configKey: 'departmentId', value: departmentId, label: 'Department' },
                { configKey: 'reportingManagerId', value: reportingManagerId, label: 'Reporting Manager' },
                { configKey: 'dateOfJoining', value: dateOfJoiningValue, label: 'Date of Joining' },
                { configKey: 'monthlyCtc', value: monthlyCtc !== undefined && monthlyCtc !== null && monthlyCtc >= 0 ? monthlyCtc : '', label: 'Month CTC Pay' },
            ]);
            if (!orgValidation.ok) {
                return errorResponse(`Missing required field(s): ${orgValidation.missing.join(', ')}`, 400);
            }
            // Re-checked here, not just at submit: a photo can be rejected or
            // removed while the request sits in the approval queue.
            if (!(await hasUsableOnboardingPhoto(id))) {
                return errorResponse('Missing required field(s): Photo (upload a passport photo that is not rejected)', 400);
            }
        }

        const outcome = await processStageAction(
            { instanceId: onboardingRequest.approvalInstanceId, actorUserId: ctx.userId, action, remarks },
            ctx
        );

        let generatedEmployeeId: string | undefined;
        let temporaryPassword: string | undefined;
        let rejoinerHint: OnboardingRejoinerHint | null = null;

        const updated = await prisma.$transaction(async (tx) => {
            if (outcome.newStatus === 'APPROVED') {
                // Race-safe re-check: intake-time checks (POST/PATCH/public
                // submit/submit-for-approval) can't catch a collision created
                // by ANOTHER request that reached final approval in between —
                // this one runs inside the same transaction that's about to
                // create the User, so it's the last word. Subsumes the old
                // mobile-only check (which didn't exclude inactive holders,
                // incorrectly blocking re-hires) — one code path for all 6
                // identity fields now.
                const duplicateCheck = await checkOnboardingDuplicates(tx, onboardingRequest, id);
                if (duplicateCheck.hit) throw new Error(formatInternalDuplicateMessage(duplicateCheck.hit));
                rejoinerHint = duplicateCheck.rejoinerHint;

                // Admin-typed, not generated — validated (non-empty, min length,
                // uniqueness) above, before processStageAction was ever called.
                generatedEmployeeId = employeeId!;
                temporaryPassword = password!;
                const hashedPassword = await hashPassword(temporaryPassword);
                const { firstName, lastName } = splitName(onboardingRequest.employeeName || generatedEmployeeId);

                const newUser = await tx.user.create({
                    data: {
                        employeeId: generatedEmployeeId,
                        password: hashedPassword,
                        firstName,
                        lastName,
                        mobileNumber: onboardingRequest.mobileNumber,
                        email: onboardingRequest.email,
                        branchId: onboardingRequest.branchId,
                        shiftId: onboardingRequest.shiftId ?? null,
                        orgRegionId: onboardingRequest.regionId ?? null,
                        orgDivisionId: onboardingRequest.divisionId ?? null,
                        departmentId: departmentId || null,
                        designationId: designationId || null,
                        dateOfJoining: dateOfJoiningValue ?? null,
                        education: onboardingRequest.educationQualification,
                        address: onboardingRequest.currentAddress,
                        permanentAddress: onboardingRequest.permanentAddress,
                        sameAsCurrentAddress: Boolean(
                            onboardingRequest.currentAddress &&
                            onboardingRequest.currentAddress === onboardingRequest.permanentAddress
                        ),
                        dob: onboardingRequest.dateOfBirth,
                        gender: onboardingRequest.gender,
                        maritalStatus: onboardingRequest.maritalStatus,
                        bloodGroup: onboardingRequest.bloodGroup,
                        emergencyContactName: onboardingRequest.emergencyContactName,
                        emergencyContactRelation: onboardingRequest.emergencyContactRelation,
                        emergencyContactMobile: onboardingRequest.emergencyContactNumber,
                        aadhaarNumber: onboardingRequest.aadhaarNumber,
                        panNumber: onboardingRequest.panNumber,
                        dlNumber: onboardingRequest.dlNumber,
                        voterIdNumber: onboardingRequest.voterIdNumber,
                        uanNumber: onboardingRequest.uanNumber,
                        pfNumber: onboardingRequest.uanNumber,
                        esiNumber: onboardingRequest.esiNumber,
                        bankName: onboardingRequest.bankName,
                        bankBranchName: onboardingRequest.bankBranchName,
                        bankAccountNumber: onboardingRequest.accountNumber,
                        bankIfscCode: onboardingRequest.ifscCode,
                        reportingManagerL1Id: reportingManagerId || null,
                        insuranceCompanyName: onboardingRequest.insuranceCompanyName,
                        insurancePolicyNumber: onboardingRequest.insurancePolicyNumber,
                        insuranceValidFrom: onboardingRequest.insuranceValidFrom,
                        insuranceValidTo: onboardingRequest.insuranceValidTo,
                        fatherName: onboardingRequest.fatherName,
                        fatherAge: onboardingRequest.fatherAge,
                        fatherAadhaarNumber: onboardingRequest.fatherAadhaarNumber,
                        motherName: onboardingRequest.motherName,
                        motherAge: onboardingRequest.motherAge,
                        motherAadhaarNumber: onboardingRequest.motherAadhaarNumber,
                        wifeName: onboardingRequest.wifeName,
                        wifeAge: onboardingRequest.wifeAge,
                        wifeAadhaarNumber: onboardingRequest.wifeAadhaarNumber,
                        wifeBankAccountNumber: onboardingRequest.wifeBankAccountNumber,
                        wifeIfscCode: onboardingRequest.wifeIfscCode,
                        wifeContactNumber: onboardingRequest.wifeContactNumber,
                        husbandName: onboardingRequest.husbandName,
                        husbandAge: onboardingRequest.husbandAge,
                        husbandAadhaarNumber: onboardingRequest.husbandAadhaarNumber,
                        husbandBankAccountNumber: onboardingRequest.husbandBankAccountNumber,
                        husbandIfscCode: onboardingRequest.husbandIfscCode,
                        husbandContactNumber: onboardingRequest.husbandContactNumber,
                        weddingDate: onboardingRequest.weddingDate,
                        children: onboardingRequest.children ?? undefined,
                        // User.role defaults to "FDO" and is synced to the designated role's
                        // legacy code via syncUserLegacyRoleFromActiveAssignments() right after
                        // this transaction commits.
                    },
                });

                await applyCtcChange(tx, {
                    employeeId: newUser.id,
                    newMonthlyCtc: monthlyCtc!,
                    source: 'ONBOARDING',
                    effectiveDate: dateOfJoiningValue ?? new Date(),
                    actorUserId: ctx.userId,
                });
                if (monthlyCtc !== undefined && monthlyCtc !== null && monthlyCtc >= 0) {
                    await applyCtcChange(tx, {
                        employeeId: newUser.id,
                        newMonthlyCtc: monthlyCtc,
                        source: 'ONBOARDING',
                        effectiveDate: dateOfJoiningValue ?? new Date(),
                        actorUserId: ctx.userId,
                    });
                }

                let defaultRoleSlug: string | null = null;
                if (designationId) {
                    const desig = await tx.designation.findUnique({
                        where: { id: designationId },
                        select: { defaultRoleSlug: true },
                    });
                    if (desig?.defaultRoleSlug) {
                        defaultRoleSlug = desig.defaultRoleSlug;
                        const targetRole = await tx.role.findFirst({
                            where: { slug: desig.defaultRoleSlug, isActive: true },
                            select: { id: true },
                        });
                        if (targetRole) {
                            await tx.userRoleAssignment.create({
                                data: {
                                    userId: newUser.id,
                                    roleId: targetRole.id,
                                    branchId: null,
                                    assignedBy: ctx.userId,
                                    isActive: true,
                                },
                            });
                        }
                    }
                }

                const isAreaManager = defaultRoleSlug === 'area-manager' || newUser.role === 'AREA_MANAGER';
                // De-duped, minus the primary branch (that one's handled separately
                // below, per role) — an admin re-picking the same branch twice in
                // the "Add Branch" list shouldn't produce a second row.
                const extraBranchIds = Array.from(new Set(additionalBranchIds ?? [])).filter(
                    (bid) => bid !== onboardingRequest.branchId
                );

                if (isAreaManager && onboardingRequest.branchId) {
                    const existingAmBranch = await tx.areaManagerBranch.findFirst({
                        where: {
                            userId: newUser.id,
                            branchId: onboardingRequest.branchId,
                        },
                    });
                    if (!existingAmBranch) {
                        await tx.areaManagerBranch.create({
                            data: {
                                userId: newUser.id,
                                branchId: onboardingRequest.branchId,
                                isPrimary: true,
                            },
                        });
                        console.info(`[Onboarding Provision] Auto-assigned primary AM branch ${onboardingRequest.branchId} for user ${newUser.id}`);
                    }
                    for (const branchId of extraBranchIds) {
                        await tx.areaManagerBranch.upsert({
                            where: { userId_branchId: { userId: newUser.id, branchId } },
                            create: { userId: newUser.id, branchId, isPrimary: false },
                            update: {},
                        });
                    }
                }

                // Any other role (the "Add Branch" picker isn't restricted to
                // Area Manager anymore) uses the generic UserBranchAssignment
                // junction — same one BRANCH_MANAGER/FDO multi-branch assignment
                // already relies on. Zero rows here is the normal/expected state
                // for a single-branch employee (see user-branch-assignments.ts),
                // so this only writes anything when extra branches were actually
                // picked — it never creates a redundant primary-only row.
                if (!isAreaManager && extraBranchIds.length > 0 && onboardingRequest.branchId) {
                    await tx.userBranchAssignment.upsert({
                        where: { userId_branchId: { userId: newUser.id, branchId: onboardingRequest.branchId } },
                        create: { userId: newUser.id, branchId: onboardingRequest.branchId, isPrimary: true },
                        update: {},
                    });
                    for (const branchId of extraBranchIds) {
                        await tx.userBranchAssignment.upsert({
                            where: { userId_branchId: { userId: newUser.id, branchId } },
                            create: { userId: newUser.id, branchId, isPrimary: false },
                            update: {},
                        });
                    }
                }

                return tx.employeeOnboardingRequest.update({
                    where: { id },
                    data: {
                        status: 'APPROVED',
                        approvedAt: new Date(),
                        createdUserId: newUser.id,
                        generatedEmployeeId,
                        // Persist the admin's final-approval org allocation onto the
                        // request record too, so its history matches the created User.
                        designationId: designationId || undefined,
                        departmentId: departmentId || undefined,
                        reportingManagerId: reportingManagerId || undefined,
                        dateOfJoining: dateOfJoiningValue,
                    },
                });
            }

            if (outcome.newStatus === 'REJECTED') {
                return tx.employeeOnboardingRequest.update({
                    where: { id },
                    data: { status: 'REJECTED', rejectionReason: remarks ?? null },
                });
            }

            // SENT_BACK / IN_PROGRESS — keep the request's own status field in sync
            // with the engine's instance status for fast list filtering.
            return tx.employeeOnboardingRequest.update({
                where: { id },
                data: { status: outcome.newStatus === 'SENT_BACK' ? 'IN_REVIEW' : 'PENDING_APPROVAL' },
            });
        });

        // Copy any documents attached during onboarding over to the new
        // employee's permanent EmployeeDocument catalog — done AFTER the
        // transaction commits (using the real newUser.id it already returned
        // via updated.createdUserId), not inside it: there's no precedent in
        // this codebase for mixing GCS I/O into a $transaction, and doing it
        // here means resolveEmployeeFolder can just query the User row
        // normally instead of needing a precomputed id. Best-effort — a copy
        // failure must never block returning the already-created
        // employeeId/temporaryPassword to the admin; an admin can re-upload
        // via /dashboard/hr/employee-documents if this step fails.
        if (outcome.newStatus === 'APPROVED' && updated.createdUserId) {
            try {
                await syncUserLegacyRoleFromActiveAssignments(updated.createdUserId);
                await invalidateUserPermissions(updated.createdUserId);
            } catch (roleSyncError) {
                console.error('Failed to sync role for newly provisioned user:', roleSyncError);
            }

            try {
                const onboardingDocs = await prisma.onboardingDocument.findMany({
                    where: { onboardingRequestId: onboardingRequest.id },
                });
                if (onboardingDocs.length) {
                    const employeeFolder = await resolveEmployeeFolder(updated.createdUserId);
                    const copied: { doc: (typeof onboardingDocs)[number]; destKey: string }[] = [];
                    for (const doc of onboardingDocs) {
                        const safeSubtype = doc.subtype ? `${doc.subtype.replace(/[^a-zA-Z0-9_-]/g, '_')}-` : '';
                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                        const extension = doc.fileName.match(/\.([a-zA-Z0-9]+)$/)?.[0]?.toLowerCase() || '';
                        const destKey = `${employeeFolder}/documents/${doc.category}/${safeSubtype}${timestamp}${extension}`;
                        await copyObject(doc.fileUrl, destKey);
                        copied.push({ doc, destKey });
                    }
                    await prisma.employeeDocument.createMany({
                        data: copied.map(({ doc, destKey }) => ({
                            employeeId: updated.createdUserId!,
                            category: doc.category,
                            subtype: doc.subtype,
                            fileUrl: destKey,
                            fileName: doc.fileName,
                            fileSize: doc.fileSize,
                            mimeType: doc.mimeType,
                            uploadedById: ctx.userId,
                            status: 'PENDING' as const,
                            remarks: `Uploaded during onboarding [${doc.uploaderType}]`,
                        })),
                    });
                }
            } catch (copyError) {
                console.error('Failed to copy onboarding documents to employee record:', copyError);
            }
        }

        return successResponse(
            {
                request: updated,
                ...outcome,
                ...(generatedEmployeeId ? { employeeId: generatedEmployeeId, temporaryPassword } : {}),
                rejoinerHint,
            },
            `Onboarding request ${action}d successfully`
        );
    } catch (error: unknown) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        // Defense-in-depth on top of the pre-check uniqueness query above — a
        // genuine race (two different requests approved concurrently with the
        // same typed/suggested Employee ID) surfaces as a raw Prisma P2002 here.
        const err = error as { code?: string; meta?: { target?: string[] }; message?: string };
        if (err.code === 'P2002' && err.meta?.target?.includes?.('employeeId')) {
            return errorResponse('That Employee ID was just taken by another approval — please use a different one', 409);
        }
        console.error('Error processing onboarding action:', error);
        return errorResponse(err.message || 'Failed to process onboarding action', 400);
    }
}
