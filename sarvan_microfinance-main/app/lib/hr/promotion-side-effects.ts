import { prisma } from '@/app/lib/db';
import { buildPromotionLetterPdf } from '@/app/lib/reports/promotion-letter-pdf';
import { uploadHrLetter } from '@/app/lib/storage/hr-letter-storage';
import { syncUserLegacyRoleFromActiveAssignments } from '@/app/lib/rbac-role-sync';
import { invalidateUserPermissions } from '@/app/lib/permissions/engine';
import { applyCtcChange } from './apply-ctc-change';
import { toDisplayDate } from '@/app/lib/date-format';

export type PromotionSideEffectsParams = {
    promotionId: string;
    employeeId: string;
    employeeFirstName: string;
    employeeLastName: string;
    employeeCode: string | null;
    departmentName: string | null;
    branchName: string | null;
    toDesignationName: string;
    actorUserId: string;
};

/**
 * Finalizes an APPROVED promotion: generates + uploads the promotion letter,
 * then in one transaction updates the employee's designation, grants the new
 * designation's default role (additive only), applies a CTC change if the
 * promotion carries one, and marks the promotion row APPROVED.
 *
 * Was previously duplicated verbatim between app/api/hr/promotions/route.ts
 * (the create-time skip-approval path) and
 * app/api/hr/promotions/[id]/approve/route.ts (the explicit-approve path) —
 * consolidated here so the CTC-write logic below only has to exist once.
 * Every mutation-critical value (status, toDesignationId, toMonthlyCtc,
 * fromMonthlyCtc, effectiveDate) is re-read fresh from the DB inside the
 * transaction rather than trusted from the caller's earlier read, mirroring
 * the race-guard the approve route already had — a promotion could only be
 * concurrently approved once, but re-reading costs nothing and removes the
 * possibility of acting on stale data.
 */
export async function executePromotionSideEffects(params: PromotionSideEffectsParams) {
    const promotion = await prisma.employeePromotion.findUnique({ where: { id: params.promotionId } });
    if (!promotion) throw new Error('Promotion request not found');

    const effectiveDateStr = toDisplayDate(promotion.effectiveDate);
    const pdfBuffer = await buildPromotionLetterPdf({
        refNo: `PRM-${params.promotionId.slice(-8).toUpperCase()}`,
        issueDate: toDisplayDate(new Date()),
        toDesignationName: params.toDesignationName,
        effectiveDate: effectiveDateStr,
        recipient: {
            employeeName: `${params.employeeFirstName} ${params.employeeLastName}`,
            employeeCode: params.employeeCode ?? 'N/A',
            designation: params.toDesignationName,
            department: params.departmentName ?? 'N/A',
            branchName: params.branchName ?? 'N/A',
        },
    });
    const letterUrl = await uploadHrLetter({
        employeeId: params.employeeId,
        letterType: 'promotion',
        pdfBuffer,
    });

    const updated = await prisma.$transaction(async (tx) => {
        const fresh = await tx.employeePromotion.findUnique({ where: { id: params.promotionId } });
        if (!fresh || fresh.status !== 'PENDING') {
            throw new Error('Promotion request status changed — please refresh and retry');
        }

        await tx.user.update({
            where: { id: params.employeeId },
            data: { designationId: fresh.toDesignationId },
        });

        // Grant the new designation's default login role, additive only.
        const toDesignation = await tx.designation.findUnique({
            where: { id: fresh.toDesignationId },
            select: { defaultRoleSlug: true },
        });
        if (toDesignation?.defaultRoleSlug) {
            const targetRole = await tx.role.findFirst({
                where: { slug: toDesignation.defaultRoleSlug, isActive: true },
                select: { id: true },
            });
            if (targetRole) {
                const existingAssignment = await tx.userRoleAssignment.findFirst({
                    where: { userId: params.employeeId, roleId: targetRole.id, isActive: true },
                });
                if (!existingAssignment) {
                    await tx.userRoleAssignment.create({
                        data: {
                            userId: params.employeeId,
                            roleId: targetRole.id,
                            branchId: null,
                            assignedBy: params.actorUserId,
                            isActive: true,
                        },
                    });
                }
            }
        }

        // Optional CTC change riding along with the promotion — null
        // toMonthlyCtc means a title-only promotion, leave CTC untouched.
        if (fresh.toMonthlyCtc != null) {
            await applyCtcChange(tx, {
                employeeId: params.employeeId,
                newMonthlyCtc: Number(fresh.toMonthlyCtc),
                source: 'PROMOTION',
                effectiveDate: fresh.effectiveDate,
                actorUserId: params.actorUserId,
                promotionId: fresh.id,
            });
        }

        return tx.employeePromotion.update({
            where: { id: params.promotionId },
            data: {
                status: 'APPROVED',
                reviewedById: params.actorUserId,
                reviewedAt: new Date(),
                letterUrl,
                letterGeneratedAt: new Date(),
            },
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
                toDesignation: { select: { id: true, name: true } },
            },
        });
    });

    try {
        await syncUserLegacyRoleFromActiveAssignments(params.employeeId);
        await invalidateUserPermissions(params.employeeId);
    } catch (roleSyncError) {
        // Best-effort — the promotion itself already committed; a sync failure here shouldn't undo it or block the response.
        console.error('Failed to sync role after promotion approval:', roleSyncError);
    }

    return updated;
}
