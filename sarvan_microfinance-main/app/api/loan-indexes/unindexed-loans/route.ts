import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { compareMemberIds } from '@/app/lib/member-id-sort';
import { createFirstLoanIfEligible } from '@/app/lib/services/first-loan.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/loan-indexes/unindexed-loans
 * Get all verified but unindexed loans for a center
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const centerId = searchParams.get('centerId');

            if (!centerId) {
                return errorResponse('Center ID is required', 400);
            }

            // Safety net: a member's first loan is auto-created at final approval, but if
            // that step failed (it never blocks the approval) the member would be missing
            // here forever. Create it now for any approved member of this center that
            // still has no loan at all — idempotent, so it is a no-op once every member has one.
            const approvedWithoutLoan = await prisma.client.findMany({
                where: {
                    centerId,
                    approvalStatus: 'APPROVED',
                    isActive: true,
                    isDefaultMember: false,
                    loanApplications: { none: {} },
                    // Only members whose enrollment captured loan details — others
                    // (e.g. bulk-imported members) can never be auto-created anyway.
                    requestedLoanProductId: { not: null },
                    requestedLoanFrequency: { not: null },
                    requestedLoanPurposeId: { not: null },
                },
                select: { id: true, clientId: true },
                take: 50,
            });
            for (const c of approvedWithoutLoan) {
                const r = await createFirstLoanIfEligible(c.id, user.userId);
                if (r.created) {
                    console.log(`[unindexed-loans] Created missing first loan ${r.loanNumber} for approved client ${c.clientId}`);
                } else {
                    console.warn(`[unindexed-loans] Could not create first loan for approved client ${c.clientId}: ${r.reason}`);
                }
            }

            // Get verified loans that are not yet indexed
            const loans = await prisma.loan.findMany({
                where: {
                    centerId,
                    applicationStatus: {
                        in: ['VERIFIED', 'PENDING_VERIFICATION']
                    },
                    indexId: null,
                    // Excludes backup/legacy-imported loans (uploan import) — those are
                    // created with indexId null (they skip the live indexation workflow
                    // entirely) but disbursementStatus DISBURSED, so without this they'd
                    // otherwise leak into the "pending indexation" list.
                    // REJECTED: rejected by the BM here (reject-loans/route.ts) — final, never re-listed.
                    disbursementStatus: { notIn: ['DISBURSED', 'REJECTED'] },
                    isActive: true,
                    // Renewal loan applications (Member Enrollment page) only become
                    // indexable once their FDO->BM->AM->QC->Admin chain finishes
                    // (finalizeRenewalApproval flips them to PENDING_VERIFICATION and
                    // renewalApprovalStatus APPROVED). null = a normal, non-renewal loan.
                    OR: [
                        { renewalApprovalStatus: null },
                        { renewalApprovalStatus: 'APPROVED' },
                    ],
                },
                select: {
                    id: true,
                    loanNumber: true,
                    amount: true,
                    appliedAmount: true,
                    interestRate: true,
                    tenureMonths: true,
                    frequency: true,
                    loanProductId: true,
                    createdAt: true,
                    loanPurposeId: true, // Add this
                    client: {
                        select: {
                            id: true,
                            clientId: true,
                            firstName: true,
                            lastName: true,
                            highmarkReports: {
                                orderBy: { pulledAt: 'desc' },
                                take: 1,
                                select: { creditScore: true, status: true },
                            },
                        },
                    },
                    loanPurpose: { // Include loanPurpose relation
                        select: {
                            id: true,
                            name: true,
                            loanPurposeType: {
                                select: {
                                    id: true,
                                    name: true,
                                },
                            },
                        },
                    },
                },
                orderBy: {
                    createdAt: 'asc',
                },
            });

            // Natural member-ID order (29-96-1-2 before 29-96-1-10); createdAt order is the tiebreaker via stable sort.
            loans.sort((a, b) => compareMemberIds(a.client.clientId, b.client.clientId));

            // Fetch product names
            const productMap: Record<string, string> = {};

            if (loans.length > 0) {
                const productIds = Array.from(new Set(loans.map(l => l.loanProductId).filter(Boolean))) as string[];

                if (productIds.length > 0) {
                    const products = await prisma.loanProduct.findMany({
                        where: {
                            id: { in: productIds },
                        },
                        select: {
                            id: true,
                            productName: true,
                        },
                    });

                    products.forEach(p => {
                        productMap[p.id] = p.productName;
                    });
                }
            }

            // Fetch prior loan history to accurately flag Renewal Loans vs New Member Loans
            const clientIds = Array.from(new Set(loans.map(l => l.client.id)));
            const priorDisbursedLoans = clientIds.length > 0
                ? await prisma.loan.findMany({
                    where: {
                        clientId: { in: clientIds },
                        disbursementStatus: 'DISBURSED',
                    },
                    select: { clientId: true },
                })
                : [];
            const priorClientSet = new Set(priorDisbursedLoans.map(l => l.clientId));

            // Format the response - use loanPurpose name as purpose and flag Renewal Loan status
            const formattedLoans = loans.map(loan => {
                const latestHm = (loan.client as any).highmarkReports?.[0];
                const isRenewal = priorClientSet.has(loan.client.id);
                return {
                    id: loan.id,
                    loanNumber: loan.loanNumber,
                    clientId: loan.client.id,
                    clientDisplayId: loan.client.clientId,
                    clientName: `${loan.client.firstName} ${loan.client.lastName}`,
                    highmarkScore: latestHm?.creditScore ?? null,
                    highmarkStatus: latestHm?.status || 'N/A',
                    purpose: loan.loanPurpose?.name || 'N/A',
                    purposeType: loan.loanPurpose?.loanPurposeType?.name || 'N/A',
                    product: (loan.loanProductId && productMap[loan.loanProductId]) || loan.loanProductId || 'N/A',
                    loanProductId: loan.loanProductId || null,
                    amount: Number(loan.amount),
                    appliedAmount: Number(loan.appliedAmount ?? loan.amount),
                    interestRate: Number(loan.interestRate),
                    tenureMonths: loan.tenureMonths,
                    frequency: loan.frequency || 'N/A',
                    isRenewal,
                    loanType: isRenewal ? 'Renewal Loan' : 'New Member Loan',
                };
            });

            return successResponse(
                formattedLoans,
                `Found ${formattedLoans.length} unindexed loan(s)`
            );
        } catch (error) {
            console.error('Error fetching unindexed loans:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch unindexed loans',
                500
            );
        }
    })(request);
}