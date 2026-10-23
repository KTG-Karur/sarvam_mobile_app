import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { accountingPostingService } from '@/app/lib/services/accounting-posting.service';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getBranchWorkingDayWindow } from '@/app/lib/branch-working-day-guard';
import { getLoanAdvanceEnabled } from '@/app/lib/loan-advance-config';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { memberIdSearchConditions } from '@/app/lib/reports/member-contacts';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/savings/refund
 * List loan advance refund requests.
 * BM sees their branch; Admin sees all.
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const status = searchParams.get('status') || undefined;
            const clientId = searchParams.get('clientId') || undefined;
            const search = searchParams.get('search')?.trim() || undefined;

            const where: any = {};
            if (status) where.status = status;
            if (clientId) where.clientId = clientId;
            if (search) {
                where.OR = [
                    { client: { firstName: { contains: search, mode: 'insensitive' } } },
                    { client: { lastName: { contains: search, mode: 'insensitive' } } },
                    { client: { clientId: { contains: search, mode: 'insensitive' } } },
                    { loan: { loanNumber: { contains: search, mode: 'insensitive' } } },
                    ...memberIdSearchConditions(search).map((client) => ({ client })),
                ];
            }

            // Scope to every branch the user is assigned to (UserBranchAssignment /
            // AreaManagerBranch), not just their primary/active branch.
            const permittedBranchIds = await getPermittedBranchIds(user);
            if (permittedBranchIds !== null && permittedBranchIds.length > 0) {
                where.branchId = permittedBranchIds.length === 1 ? permittedBranchIds[0] : { in: permittedBranchIds };
            }

            const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
            const pageSize = Math.min(5000, Math.max(1, parseInt(searchParams.get('pageSize') ?? '25', 10)));

            const [totalCount, requests] = await Promise.all([
                prisma.savingsRefundRequest.count({ where }),
                prisma.savingsRefundRequest.findMany({
                    where,
                    include: {
                        loan: { select: { loanNumber: true } },
                        client: { select: { firstName: true, lastName: true, clientId: true, loanAdvance: true } },
                        center: { select: { name: true, code: true } },
                        initiatedBy: { select: { firstName: true, lastName: true } },
                        reviewedBy: { select: { firstName: true, lastName: true } },
                    },
                    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                }),
            ]);

            const data = requests.map((r) => ({
                id: r.id,
                loanNumber: r.loan.loanNumber,
                clientName: `${r.client.firstName} ${r.client.lastName}`,
                clientId: r.client.clientId,
                loanAdvanceBalance: Number(r.client.loanAdvance ?? 0),
                centerName: `${r.center?.name} (${r.center?.code})`,
                totalSavings: Number(r.totalSavings),
                refundAmount: Number(r.refundAmount),
                status: r.status,
                remarks: r.remarks,
                initiatedBy: `${r.initiatedBy.firstName} ${r.initiatedBy.lastName}`,
                initiatedAt: r.initiatedAt,
                reviewedBy: r.reviewedBy ? `${r.reviewedBy.firstName} ${r.reviewedBy.lastName}` : null,
                reviewedAt: r.reviewedAt,
                reviewRemarks: r.reviewRemarks,
            }));

            return successResponse(
                { data, totalCount, totalPages: Math.ceil(totalCount / pageSize), page, pageSize },
                'Loan advance refund requests fetched'
            );
        } catch (error) {
            console.error('Error fetching loan advance refund requests:', error);
            return errorResponse('Failed to fetch loan advance refund requests', 500);
        }
    })(request);
}

/**
 * POST /api/savings/refund
 * BM initiates a loan advance refund request.
 * Body: { clientId, refundAmount, remarks }
 */
export async function POST(request: NextRequest) {
    return withRole(['BRANCH_MANAGER', 'ADMIN'], async (req, user) => {
        try {
            if (!(await getLoanAdvanceEnabled())) {
                return errorResponse('Loan Advance is currently disabled', 403);
            }

            const body = await req.json();
            const { clientId, loanId, refundAmount, remarks } = body;

            if (!clientId && !loanId) return errorResponse('clientId is required', 400);
            if (!refundAmount || Number(refundAmount) <= 0) return errorResponse('refundAmount must be positive', 400);

            // If only loanId provided, get clientId from loan
            let resolvedClientId = clientId;
            let resolvedLoanId = loanId;

            if (!resolvedClientId && resolvedLoanId) {
                const loan = await prisma.loan.findUnique({
                    where: { id: resolvedLoanId },
                    select: { clientId: true },
                });
                if (!loan) return errorResponse('Loan not found', 404);
                resolvedClientId = loan.clientId;
            }

            const client = await prisma.client.findUnique({
                where: { id: resolvedClientId },
                select: {
                    id: true,
                    centerId: true,
                    center: { select: { branchId: true } },
                    loanAdvance: true,
                    loanApplications: {
                        select: { id: true },
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                    },
                },
            });

            if (!client) return errorResponse('Client not found', 404);

            const totalLoanAdvance = Number(client.loanAdvance ?? 0);
            const amount = Number(Number(refundAmount).toFixed(2));

            // Loan Advance refund eligibility depends only on the client's loan advance
            // balance, not on whether they currently have an active/disbursed loan.
            if (totalLoanAdvance <= 0) {
                return errorResponse('No Loan Advance balance available for refund', 400);
            }

            if (amount > totalLoanAdvance) {
                return errorResponse(`Refund amount (₹${amount}) exceeds total loan advance balance (₹${totalLoanAdvance})`, 400);
            }

            // SavingsRefundRequest.loanId is a required FK — use the client's most
            // recent loan of any status just to satisfy it, not as an eligibility gate.
            const activeLoanId = resolvedLoanId || client.loanApplications[0]?.id;
            if (!activeLoanId) return errorResponse('Unable to find a loan record to link this refund request', 400);

            // Check for existing pending request
            const existingPending = await prisma.savingsRefundRequest.findFirst({
                where: { clientId: resolvedClientId, status: 'PENDING_APPROVAL' },
                select: { id: true },
            });
            if (existingPending) {
                return errorResponse('A pending loan advance refund request already exists for this client', 409);
            }

            // Savings refund requires the client to be assigned to a center
            if (!client.centerId || !client.center?.branchId) {
                return errorResponse('Client must be assigned to a center before initiating a loan advance refund', 400);
            }

            const branchId = client.center.branchId;

            // Stamp the request with the branch's EOD working date, not the wall-clock
            // "now" — the refund is initiated as part of that branch's current working
            // day. Anchor at UTC midnight of the YMD so the displayed date is the same
            // regardless of the viewer's timezone.
            const workingDay = await getBranchWorkingDayWindow({ branchId });
            const initiatedAt = new Date(`${workingDay.workingDateYmd}T00:00:00.000Z`);

            const refundRequest = await prisma.savingsRefundRequest.create({
                data: {
                    loanId: activeLoanId,
                    clientId: resolvedClientId,
                    centerId: client.centerId,
                    branchId,
                    totalSavings: totalLoanAdvance,
                    refundAmount: amount,
                    remarks: remarks || null,
                    status: 'PENDING_APPROVAL',
                    initiatedById: user.userId,
                    initiatedAt,
                },
                select: { id: true },
            });

            return successResponse({ id: refundRequest.id }, 'Loan advance refund request submitted for approval', 201);
        } catch (error) {
            console.error('Error creating loan advance refund request:', error);
            return errorResponse('Failed to create loan advance refund request', 500);
        }
    })(request);
}

/**
 * PUT /api/savings/refund
 * Admin, Sub Admin (Role.isSubAdmin) or Area Manager approves or rejects a loan
 * advance refund request.
 * Body: { id, action: 'APPROVE' | 'REJECT', reviewRemarks }
 */
export async function PUT(request: NextRequest) {
    // withAuth (not withRole): a Sub Admin's user.role is an admin-created role code.
    return withAuth(async (req, user) => {
        try {
            const isSubAdmin = user.role !== 'ADMIN' && await isSubAdminUser(user.userId);
            if (user.role !== 'ADMIN' && user.role !== 'AREA_MANAGER' && !isSubAdmin) {
                return errorResponse('Only Admin, Sub Admin or Area Manager can approve loan advance refunds', 403);
            }

            const body = await req.json();
            const { id, action, reviewRemarks } = body;

            if (!id) return errorResponse('id is required', 400);
            if (!['APPROVE', 'REJECT'].includes(action)) return errorResponse('action must be APPROVE or REJECT', 400);

            const refundRequest = await prisma.savingsRefundRequest.findUnique({
                where: { id },
                include: {
                    client: { select: { id: true, loanAdvance: true, firstName: true, lastName: true, clientId: true } },
                    loan: { select: { loanNumber: true } },
                },
            });

            if (!refundRequest) return errorResponse('Loan advance refund request not found', 404);
            if (refundRequest.status !== 'PENDING_APPROVAL') {
                return errorResponse(`Request is already ${refundRequest.status}`, 400);
            }

            // AM: assigned branches. Sub Admin: Head Office–based → all branches; otherwise
            // their assigned branches (same rule as getPermittedBranchIds everywhere).
            if (user.role !== 'ADMIN') {
                const permittedBranchIds = await getPermittedBranchIds(user);
                if (permittedBranchIds !== null && !permittedBranchIds.includes(refundRequest.branchId)) {
                    return errorResponse('This request does not belong to one of your assigned branches', 403);
                }
            }

            const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

            // The refund's business transactions (LoanTransaction + the paired GL Cash
            // Payment voucher) must be dated in the *client's branch* current EOD working
            // day — never wall-clock "now" or the approver's branch. `refundRequest.branchId`
            // was stamped from the client's center at initiate time. Anchor at UTC midnight
            // of the YMD to match how FinancialTransaction dates are stored/queried.
            const clientWorkingDay = await getBranchWorkingDayWindow({ branchId: refundRequest.branchId });
            const businessDate = new Date(`${clientWorkingDay.workingDateYmd}T00:00:00.000Z`);

            await prisma.$transaction(async (tx) => {
                await tx.savingsRefundRequest.update({
                    where: { id },
                    data: {
                        status: newStatus,
                        reviewedById: user.userId,
                        reviewedAt: new Date(),
                        reviewRemarks: reviewRemarks || null,
                        // A fresh approval is not (yet) in a reverted state — reset so the
                        // request becomes revertible again after a prior revert-to-pending
                        // cycle (see app/api/savings/refund/revert/route.ts). REJECT leaves
                        // this untouched (undefined is omitted by Prisma): a rejected request
                        // was never approved-then-reverted in this cycle.
                        isReversed: action === 'APPROVE' ? false : undefined,
                    },
                });

                if (action === 'APPROVE') {
                    // `now` = real audit timestamps (when the approver acted);
                    // `businessDate` = the client-branch working day the money moves on.
                    const now = new Date();
                    const txnId = `TXN-LAVREF-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
                    await tx.loanTransaction.create({
                        data: {
                            transactionId: txnId,
                            loanId: refundRequest.loanId,
                            branchId: refundRequest.branchId,
                            centerId: refundRequest.centerId,
                            clientId: refundRequest.clientId,
                            amount: refundRequest.refundAmount,
                            type: 'SAVINGS_REFUND' as any,
                            paymentMode: 'CASH',
                            transactionDate: businessDate,
                            collectedById: user.userId,
                            status: 'APPROVED',
                            approvedById: user.userId,
                            approvedAt: now,
                            remarks: reviewRemarks || 'Loan advance refund approved',
                        } as any,
                    });

                    // Deduct from Client.loanAdvance
                    const currentBalance = Number(refundRequest.client.loanAdvance ?? 0);
                    const newBalance = Math.max(0, currentBalance - Number(refundRequest.refundAmount));
                    await tx.client.update({
                        where: { id: refundRequest.clientId },
                        data: { loanAdvance: newBalance },
                    });

                    // Also deduct from Loan.savingsPaid for schedule tracking
                    await tx.loan.update({
                        where: { id: refundRequest.loanId },
                        data: { savingsPaid: { decrement: Number(refundRequest.refundAmount) } },
                    });

                    // Post the corresponding Cash Payment voucher (Dr LOAN ADVANCE / Cr Cash in
                    // Hand), directly approved — same maker-checker reasoning as every other
                    // system posting in accounting-posting.service.ts (this refund request
                    // already went through its own approval). Store the voucher's id on the
                    // request for traceability and for the revert flow to find it directly.
                    const { financialTransactionId } = await accountingPostingService.postSavingsRefundPayment({
                        tx,
                        refundRequestId: id,
                        branchId: refundRequest.branchId,
                        amount: Number(refundRequest.refundAmount),
                        description: `Loan Advance Refund - ${refundRequest.client.firstName} ${refundRequest.client.lastName} (${refundRequest.client.clientId}) - Loan ${refundRequest.loan.loanNumber}`,
                        transactionDate: businessDate,
                        createdById: user.userId,
                        createdByRole: user.role,
                    });
                    await tx.savingsRefundRequest.update({
                        where: { id },
                        data: { financialTransactionId },
                    });
                }
            });

            return successResponse(null, `Loan advance refund request ${newStatus.toLowerCase()}`);
        } catch (error) {
            console.error('Error processing loan advance refund request:', error);
            return errorResponse('Failed to process loan advance refund request', 500);
        }
    })(request);
}
