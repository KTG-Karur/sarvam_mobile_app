import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { ClientApprovalStatus, KYCDocumentDecision } from '@prisma/client';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { getActiveWorkflowConfig } from '@/app/lib/workflow-config';
import { createFirstLoanIfEligible } from '@/app/lib/services/first-loan.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/approval/clients/bulk-action
 * Execute a stage-level action on multiple clients at once.
 *
 * Body:
 *   clientIds: string[]  — list of client IDs (the clientId field, NOT the DB id)
 *   action:    string    — same actions as individual action endpoint
 *   remarks?:  string
 *
 * Returns per-client results with success/failure indicators.
 *
 * @access BRANCH_MANAGER, AREA_MANAGER, ADMIN, Sub Admin roles (FINAL_ actions only)
 */
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const isSubAdmin = user.role !== 'ADMIN' && await isSubAdminUser(user.userId);
            const baseAllowedRoles = ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN'];
            if (!baseAllowedRoles.includes(user.role) && !isSubAdmin) {
                return errorResponse('Insufficient permissions', 403);
            }

            const body = await req.json();
            const { clientIds, action, remarks } = body as {
                clientIds: string[];
                action: string;
                remarks?: string;
            };

            if (!Array.isArray(clientIds) || clientIds.length === 0) {
                return errorResponse('clientIds must be a non-empty array', 400);
            }

            if (clientIds.length > 50) {
                return errorResponse('Cannot process more than 50 clients at once', 400);
            }

            const validActions = [
                'BM_SUBMIT_TO_AM', 'BM_RETAKE', 'BM_REJECT',
                'AM_APPROVE', 'AM_RETAKE', 'AM_REJECT',
                'FINAL_APPROVE', 'FINAL_RETAKE', 'FINAL_REJECT',
            ];
            if (!validActions.includes(action)) {
                return errorResponse(`Invalid action. Must be one of: ${validActions.join(', ')}`, 400);
            }

            // Role restrictions
            if (user.role === 'BRANCH_MANAGER' && !action.startsWith('BM_')) {
                return errorResponse('Branch Manager can only perform BM actions', 403);
            }
            if (user.role === 'AREA_MANAGER' && !action.startsWith('AM_')) {
                return errorResponse('Area Manager can only perform AM actions', 403);
            }
            if (isSubAdmin && !action.startsWith('FINAL_')) {
                return errorResponse('Sub Admin can only perform final approval actions', 403);
            }
            if (action.startsWith('FINAL_') && user.role !== 'ADMIN' && !isSubAdmin) {
                return errorResponse('Only Admin can perform final approval actions', 403);
            }

            // Admin's legacy BM_/AM_ override must not jump the queue once a
            // dynamic ClientWorkflowConfig is active — see the matching guard in
            // the single-client action route for the full rationale.
            // Same for BM/AM themselves: these bulk actions hard-code the BM → AM order.
            if (action.startsWith('BM_') || action.startsWith('AM_')) {
                const wfConfig = await getActiveWorkflowConfig();
                if (wfConfig) {
                    return errorResponse(
                        user.role === 'ADMIN'
                            ? 'A dynamic approval workflow is active — Admin can only give Final Approval once all stages are complete.'
                            : 'A dynamic approval workflow is active — approve each member from its stage in the Approval Workbench.',
                        403
                    );
                }
            }

            // Remarks required for retake/reject
            if ((action.includes('RETAKE') || action.includes('REJECT')) && (!remarks || !remarks.trim())) {
                return errorResponse('Remarks are required for retake or reject actions', 400);
            }

            // Branch scoping for BM
            let branchId: string | null = null;
            if (user.role === 'BRANCH_MANAGER') {
                const u = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });
                if (!u?.branchId) {
                    return errorResponse('User is not assigned to a branch', 403);
                }
                branchId = u.branchId;
            }

            // Determine expected statuses and target status
            const bmAllowedFrom: ClientApprovalStatus[] = ['SUBMITTED', 'PENDING_BM_REVIEW'];
            const amAllowedFrom: ClientApprovalStatus[] = ['PENDING_AM_REVIEW'];
            const finalAllowedFrom = ['PENDING_FINAL_REVIEW'] as ClientApprovalStatus[];

            let allowedFromStatuses: ClientApprovalStatus[];
            let newStatus: ClientApprovalStatus;
            let auditAction: string;
            let legacyVerificationStatus: string | null = null;

            switch (action) {
                case 'BM_SUBMIT_TO_AM':
                    allowedFromStatuses = bmAllowedFrom;
                    newStatus = 'PENDING_AM_REVIEW';
                    auditAction = 'BM_COMPLETED_REVIEW';
                    legacyVerificationStatus = 'UNDER_REVIEW';
                    break;
                case 'BM_RETAKE':
                    allowedFromStatuses = bmAllowedFrom;
                    newStatus = 'BM_RETAKE_REQUIRED';
                    auditAction = 'BM_RETAKE_DOCUMENT';
                    legacyVerificationStatus = 'PENDING_VERIFICATION';
                    break;
                case 'BM_REJECT':
                    allowedFromStatuses = bmAllowedFrom;
                    newStatus = 'REJECTED';
                    auditAction = 'BM_REJECTED_CLIENT';
                    legacyVerificationStatus = 'REJECTED';
                    break;
                case 'AM_APPROVE':
                    allowedFromStatuses = amAllowedFrom;
                    newStatus = 'PENDING_FINAL_REVIEW' as ClientApprovalStatus;
                    auditAction = 'AM_APPROVED_CLIENT';
                    legacyVerificationStatus = 'UNDER_REVIEW';
                    break;
                case 'AM_RETAKE':
                    allowedFromStatuses = amAllowedFrom;
                    newStatus = 'AM_RETAKE_REQUIRED';
                    auditAction = 'AM_RETAKE_DOCUMENT';
                    legacyVerificationStatus = 'PENDING_VERIFICATION';
                    break;
                case 'AM_REJECT':
                    allowedFromStatuses = amAllowedFrom;
                    newStatus = 'REJECTED';
                    auditAction = 'AM_REJECTED_CLIENT';
                    legacyVerificationStatus = 'REJECTED';
                    break;
                case 'FINAL_APPROVE':
                    allowedFromStatuses = finalAllowedFrom;
                    newStatus = 'APPROVED';
                    auditAction = 'FINAL_APPROVED_CLIENT';
                    legacyVerificationStatus = 'VERIFIED';
                    break;
                case 'FINAL_RETAKE':
                    allowedFromStatuses = finalAllowedFrom;
                    newStatus = 'FINAL_RETAKE_REQUIRED' as ClientApprovalStatus;
                    auditAction = 'FINAL_RETAKE_CLIENT';
                    legacyVerificationStatus = 'PENDING_VERIFICATION';
                    break;
                case 'FINAL_REJECT':
                    allowedFromStatuses = finalAllowedFrom;
                    newStatus = 'REJECTED';
                    auditAction = 'FINAL_REJECTED_CLIENT';
                    legacyVerificationStatus = 'REJECTED';
                    break;
                default:
                    return errorResponse('Unhandled action', 400);
            }

            // Fetch all clients
            const clients = await prisma.client.findMany({
                where: {
                    clientId: { in: clientIds },
                    isActive: true,
                },
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    approvalStatus: true,
                    centerId: true,
                    center: { select: { branchId: true } },
                    enrolledBy: { select: { branchId: true } },
                    kycDocuments: {
                        where: { isDeleted: false },
                        select: { id: true, bmDecision: true, amDecision: true },
                    },
                },
            });

            const now = new Date();
            const results: Array<{
                clientId: string;
                name: string;
                success: boolean;
                error?: string;
                warning?: string;
            }> = [];

            for (const client of clients) {
                // Branch check — fall back to enrolledBy.branchId for clients without a center yet
                const clientBranchId = client.center?.branchId ?? client.enrolledBy?.branchId ?? null;
                if (branchId && clientBranchId !== branchId) {
                    results.push({
                        clientId: client.clientId,
                        name: `${client.firstName} ${client.lastName}`,
                        success: false,
                        error: 'Client not in your branch',
                    });
                    continue;
                }

                // Status check
                if (!allowedFromStatuses.includes(client.approvalStatus)) {
                    results.push({
                        clientId: client.clientId,
                        name: `${client.firstName} ${client.lastName}`,
                        success: false,
                        error: `Invalid status: ${client.approvalStatus}`,
                    });
                    continue;
                }

                // For BM_SUBMIT_TO_AM: check all docs reviewed
                if (action === 'BM_SUBMIT_TO_AM') {
                    const retakeDocs = client.kycDocuments.filter(d => d.bmDecision === 'RETAKE_REQUIRED');
                    if (retakeDocs.length > 0) {
                        results.push({
                            clientId: client.clientId,
                            name: `${client.firstName} ${client.lastName}`,
                            success: false,
                            error: `${retakeDocs.length} retake-pending docs`,
                        });
                        continue;
                    }
                }

                // For AM_APPROVE: check all docs AM-reviewed
                if (action === 'AM_APPROVE') {
                    const bmUnreviewed = client.kycDocuments.filter(d => d.bmDecision === 'PENDING');
                    if (bmUnreviewed.length > 0) {
                        results.push({
                            clientId: client.clientId,
                            name: `${client.firstName} ${client.lastName}`,
                            success: false,
                            error: `${bmUnreviewed.length} docs still pending BM review`,
                        });
                        continue;
                    }
                }

                // Execute the transition
                try {
                    const clientUpdate: any = {
                        approvalStatus: newStatus,
                    };
                    if (action.startsWith('BM_')) {
                        clientUpdate.bmReviewedById = user.userId;
                        clientUpdate.bmReviewedAt = now;
                        clientUpdate.bmRemarks = remarks || null;
                    }
                    if (action.startsWith('AM_')) {
                        clientUpdate.amReviewedById = user.userId;
                        clientUpdate.amReviewedAt = now;
                        clientUpdate.amRemarks = remarks || null;
                    }
                    if (action.startsWith('FINAL_')) {
                        clientUpdate.finalReviewedById = user.userId;
                        clientUpdate.finalReviewedAt = now;
                        clientUpdate.finalRemarks = remarks || null;
                    }
                    if (legacyVerificationStatus) {
                        clientUpdate.verificationStatus = legacyVerificationStatus;
                    }
                    if (action === 'FINAL_APPROVE') {
                        clientUpdate.verifiedById = user.userId;
                        clientUpdate.verifiedAt = now;
                    }
                    if (action === 'BM_REJECT' || action === 'AM_REJECT' || action === 'FINAL_REJECT') {
                        clientUpdate.rejectionReason = remarks;
                    }

                    await prisma.$transaction(async (tx) => {
                        // Auto-approve pending docs for the acting stage before status transition.
                        if (action === 'BM_SUBMIT_TO_AM') {
                            const pendingBmDocs = await tx.kYC.findMany({
                                where: {
                                    clientId: client.id,
                                    isDeleted: false,
                                    bmDecision: 'PENDING',
                                },
                                select: { id: true },
                            });

                            if (pendingBmDocs.length > 0) {
                                const pendingBmDocIds = pendingBmDocs.map((d) => d.id);
                                await tx.kYC.updateMany({
                                    where: {
                                        id: { in: pendingBmDocIds },
                                        clientId: client.id,
                                        isDeleted: false,
                                        bmDecision: 'PENDING',
                                    },
                                    data: {
                                        bmDecision: 'VERIFIED',
                                        bmRemark: null,
                                        bmReviewerId: user.userId,
                                        bmReviewedAt: now,
                                        status: 'VERIFIED',
                                    },
                                });

                                await tx.clientApprovalHistory.createMany({
                                    data: pendingBmDocIds.map((docId) => ({
                                        clientId: client.id,
                                        action: 'BM_VERIFIED_DOCUMENT' as any,
                                        performedById: user.userId,
                                        remarks: 'Bulk auto-verified before submit to AM',
                                        kycDocumentId: docId,
                                        previousState: null,
                                        newState: null,
                                    })),
                                });
                            }
                        }

                        if (action === 'AM_APPROVE') {
                            const pendingAmDocs = await tx.kYC.findMany({
                                where: {
                                    clientId: client.id,
                                    isDeleted: false,
                                    amDecision: 'PENDING',
                                    bmDecision: { not: 'PENDING' },
                                },
                                select: { id: true },
                            });

                            if (pendingAmDocs.length > 0) {
                                const pendingAmDocIds = pendingAmDocs.map((d) => d.id);
                                await tx.kYC.updateMany({
                                    where: {
                                        id: { in: pendingAmDocIds },
                                        clientId: client.id,
                                        isDeleted: false,
                                        amDecision: 'PENDING',
                                        bmDecision: { not: 'PENDING' },
                                    },
                                    data: {
                                        amDecision: 'VERIFIED',
                                        amRemark: null,
                                        amReviewerId: user.userId,
                                        amReviewedAt: now,
                                        status: 'VERIFIED',
                                    },
                                });

                                await tx.clientApprovalHistory.createMany({
                                    data: pendingAmDocIds.map((docId) => ({
                                        clientId: client.id,
                                        action: 'AM_VERIFIED_DOCUMENT' as any,
                                        performedById: user.userId,
                                        remarks: 'Bulk auto-verified before approve',
                                        kycDocumentId: docId,
                                        previousState: null,
                                        newState: null,
                                    })),
                                });
                            }
                        }

                        await tx.client.update({
                            where: { id: client.id },
                            data: clientUpdate,
                        });

                        await tx.clientApprovalHistory.create({
                            data: {
                                clientId: client.id,
                                action: auditAction as any,
                                performedById: user.userId,
                                remarks: remarks || null,
                                previousState: JSON.stringify({ approvalStatus: client.approvalStatus }),
                                newState: JSON.stringify({ approvalStatus: newStatus }),
                            },
                        });
                    });

                    // Same as the single FINAL_APPROVE action: auto-create the first loan
                    // so the member lands in Loan Indexation. Best-effort — never fails
                    // the approval; a skip is reported back as a warning.
                    let warning: string | undefined;
                    if (action === 'FINAL_APPROVE') {
                        const firstLoan = await createFirstLoanIfEligible(client.id, user.userId);
                        if (!firstLoan.created && firstLoan.reason !== 'Client already has a loan record') {
                            console.warn(`[bulk FINAL_APPROVE] First loan not created for ${client.clientId}: ${firstLoan.reason}`);
                            warning = `Approved, but first loan not created: ${firstLoan.reason}`;
                        }
                    }

                    results.push({
                        clientId: client.clientId,
                        name: `${client.firstName} ${client.lastName}`,
                        success: true,
                        ...(warning ? { warning } : {}),
                    });
                } catch (err) {
                    console.error(`Bulk action error for ${client.clientId}:`, err);
                    results.push({
                        clientId: client.clientId,
                        name: `${client.firstName} ${client.lastName}`,
                        success: false,
                        error: 'Transaction failed',
                    });
                }
            }

            // Handle clients not found in DB
            const foundIds = clients.map(c => c.clientId);
            const notFound = clientIds.filter(id => !foundIds.includes(id));
            for (const id of notFound) {
                results.push({
                    clientId: id,
                    name: 'Unknown',
                    success: false,
                    error: 'Client not found',
                });
            }

            const successCount = results.filter(r => r.success).length;
            const failedCount = results.filter(r => !r.success).length;

            return successResponse(
                {
                    results,
                    summary: {
                        total: results.length,
                        success: successCount,
                        failed: failedCount,
                    },
                },
                `Bulk action completed: ${successCount} succeeded, ${failedCount} failed`
            );
        } catch (error) {
            console.error('Error executing bulk approval action:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to execute bulk action',
                500
            );
        }
    })(request);
}

