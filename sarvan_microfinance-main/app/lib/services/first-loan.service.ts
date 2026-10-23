import { prisma } from '@/app/lib/prisma';
import { loanService } from '@/app/lib/services/loan.service';

const VALID_FREQUENCIES = ['daily', 'weekly', 'forthnight', 'monthly', 'quarterly'];

// Mirrors app/api/loans/[loanId]/update-product/route.ts's tenureMonths derivation.
function computeTenureMonths(numberOfDues: number, frequency: string): number {
    const freq = (frequency || '').toLowerCase();
    if (freq === 'weekly') return Math.ceil(numberOfDues / 4.33);
    if (freq === 'forthnight') return Math.ceil(numberOfDues / 2.17);
    if (freq === 'daily') return Math.ceil(numberOfDues / 30);
    if (freq === 'quarterly') return numberOfDues * 3;
    return numberOfDues;
}

/**
 * Auto-creates a client's first loan application from the loan details they
 * captured during enrollment (Loan Details tab) — skipping the manual FDO
 * "Application" step. Called from the FINAL_APPROVE action after a client is
 * fully approved. Best-effort: never throws, and skips silently (logging why)
 * if the client already has a loan or didn't capture enough loan detail —
 * FDO can always fall back to the manual Application screen in that case.
 */
type FirstLoanResult = { created: boolean; loanId?: string; loanNumber?: string; reason?: string };

// Skip reasons that are a property of the member's data — retrying cannot change them.
const PERMANENT_SKIP_REASONS = new Set([
    'Client already has a loan record',
    'Client not found',
    'Incomplete loan details captured at enrollment',
    'Requested loan product no longer available',
]);

/**
 * Retries transient failures (DB timeout, dropped pooled connection, loan-number
 * race) so one hiccup at approval time can't leave an approved member without a
 * loan — and so out of Loan Indexation. Each attempt re-checks for an existing
 * loan first, so a retry can never create a duplicate.
 */
export async function createFirstLoanIfEligible(
    clientId: string,
    triggeredById: string,
    maxAttempts = 5
): Promise<FirstLoanResult> {
    let last: FirstLoanResult = { created: false, reason: 'Not attempted' };
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        last = await attemptFirstLoan(clientId, triggeredById);
        if (last.created || PERMANENT_SKIP_REASONS.has(last.reason ?? '') || last.reason?.startsWith('Unrecognized frequency')) {
            return last;
        }
        if (attempt < maxAttempts) {
            console.warn(`[createFirstLoanIfEligible] attempt ${attempt} failed for client ${clientId}: ${last.reason} — retrying`);
            // Exponential backoff (0.5s, 1s, 2s, 4s ≈ 7.5s total) — long enough to ride out a
            // pooled-connection drop, which a ~1s window could not (client 41-22-1-4, Oct 2026).
            await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
        }
    }
    return last;
}

async function attemptFirstLoan(clientId: string, triggeredById: string): Promise<FirstLoanResult> {
    try {
        const existingLoanCount = await prisma.loan.count({ where: { clientId } });
        if (existingLoanCount > 0) {
            return { created: false, reason: 'Client already has a loan record' };
        }

        const client = await prisma.client.findUnique({
            where: { id: clientId },
            select: {
                centerId: true,
                requestedLoanProductId: true,
                requestedAmount: true,
                requestedLoanFrequency: true,
                requestedLoanPurposeId: true,
            },
        });
        if (!client) {
            return { created: false, reason: 'Client not found' };
        }
        if (
            !client.centerId ||
            !client.requestedLoanProductId ||
            !client.requestedLoanFrequency ||
            !client.requestedLoanPurposeId
        ) {
            return { created: false, reason: 'Incomplete loan details captured at enrollment' };
        }
        const frequency = client.requestedLoanFrequency.toLowerCase();
        if (!VALID_FREQUENCIES.includes(frequency)) {
            return { created: false, reason: `Unrecognized frequency: ${client.requestedLoanFrequency}` };
        }

        const product = await prisma.loanProduct.findUnique({
            where: { id: client.requestedLoanProductId },
            select: { interestRate: true, numberOfDues: true, frequency: true, isActive: true, loanAmount: true },
        });
        if (!product || !product.isActive) {
            return { created: false, reason: 'Requested loan product no longer available' };
        }
        // requestedAmount is auto-derived from the selected product at enrollment, but an
        // edit path can null it while leaving the product set (and legacy rows predate
        // that derivation) — fall back to the product's own amount so a member with a
        // valid product selection is never dropped from Loan Indexation over a blank amount.
        const effectiveAmount = client.requestedAmount ?? product.loanAmount;
        if (!effectiveAmount || Number(effectiveAmount) <= 0) {
            return { created: false, reason: 'Incomplete loan details captured at enrollment' };
        }
        const tenureMonths = computeTenureMonths(product.numberOfDues, product.frequency);

        const primaryCoApplicant = await prisma.coApplicant.findFirst({
            where: { clientId, isPrimary: true, status: { in: ['APPROVED', 'ACTIVE'] } },
            select: { id: true },
        });

        const result = await loanService.createLoanApplication(
            {
                clientId,
                centerId: client.centerId,
                loanProductId: client.requestedLoanProductId,
                amount: effectiveAmount.toString(),
                interestRate: product.interestRate.toString(),
                tenureMonths,
                frequency: frequency as 'daily' | 'weekly' | 'forthnight' | 'monthly' | 'quarterly',
                loanPurposeId: client.requestedLoanPurposeId,
                coApplicantId: primaryCoApplicant?.id,
            },
            triggeredById,
            { skipRoleCheck: true }
        );

        if (!result.success) {
            return { created: false, reason: result.error || 'Loan creation failed' };
        }
        return { created: true, loanId: result.loanId, loanNumber: result.loanNumber };
    } catch (error) {
        console.error('[createFirstLoanIfEligible] Unexpected error:', error);
        return { created: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
}
