/**
 * Returns data to reset BOTH legacy verification fields AND CR-3 approval fields.
 * Used when a client profile edit invalidates existing approval stages.
 */
export function buildKycResetData() {
    return {
        // Legacy fields — backward compatibility
        verificationStatus: 'PENDING_VERIFICATION' as const,
        verifiedById: null,
        verifiedAt: null,
        rejectionReason: null,
        // CR-3 approval workflow reset
        approvalStatus: 'SUBMITTED' as const,
        bmReviewedById: null,
        bmReviewedAt: null,
        bmRemarks: null,
        amReviewedById: null,
        amReviewedAt: null,
        amRemarks: null,
    };
}

/**
 * Full workflow restart — used when Admin/Sub Admin edits an already-APPROVED
 * client. Extends buildKycResetData() by also clearing QC and Final review
 * metadata, since the whole staged approval must restart from BM review.
 */
export function buildApprovalRestartData() {
    return {
        ...buildKycResetData(),
        qcVerifiedById: null,
        qcVerifiedAt: null,
        qcRemarks: null,
        finalReviewedById: null,
        finalReviewedAt: null,
        finalRemarks: null,
    };
}
