import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
    withAuth,
} from '@/app/lib/api-utils';
import { loanApplicationSchema } from '@/app/lib/validations/loan.validation';
import { loanService } from '@/app/lib/services/loan.service';
import { prisma } from '@/app/lib/prisma';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

/**
 * @swagger
 * /api/loans:
 *   post:
 *     tags:
 *       - Loans
 *     summary: Create Loan Application
 *     description: Create a new loan application. **FDO only.** Client must be verified.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clientId
 *               - centerId
 *               - loanProductId
 *               - amount
 *               - interestRate
 *               - tenureMonths
 *               - frequency
 *               - purpose
 *             properties:
 *               clientId:
 *                 type: string
 *               centerId:
 *                 type: string
 *               loanProductId:
 *                 type: string
 *               amount:
 *                 type: string
 *                 example: "10000"
 *               interestRate:
 *                 type: string
 *                 example: "12.5"
 *               tenureMonths:
 *                 type: number
 *                 example: 12
 *               frequency:
 *                 type: string
 *                 enum: [daily, weekly, forthnight, monthly, quarterly]
 *               purpose:
 *                 type: string
 *                 enum: [business, agriculture, education, health, housing, other]
 *     responses:
 *       201:
 *         description: Loan application created successfully
 *       400:
 *         description: Invalid request data or client not verified
 *       403:
 *         description: FDO access required or insufficient permissions
 *   get:
 *     tags:
 *       - Loans
 *     summary: List Loans
 *     description: Fetch loans with optional filters (excludes inactive loans)
 *     parameters:
 *       - in: query
 *         name: centerId
 *         schema:
 *           type: string
 *         description: Filter by center ID
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: string
 *         description: Filter by client ID
 *       - in: query
 *         name: applicationStatus
 *         schema:
 *           type: string
 *           enum: [DRAFT, PENDING_VERIFICATION, VERIFIED, REJECTED]
 *         description: Filter by application status
 *       - in: query
 *         name: disbursementStatus
 *         schema:
 *           type: string
 *           enum: [PENDING_LEVEL1, APPROVED_LEVEL1, PENDING_LEVEL2, DISBURSED, REJECTED]
 *         description: Filter by disbursement status
 *       - in: query
 *         name: page
 *         schema:
 *           type: number
 *         description: Page number (default: 1)
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: number
 *         description: Items per page (default: 10)
 *       - in: query
 *         name: includeInactive
 *         schema:
 *           type: boolean
 *         description: Include inactive/deleted loans (admin only)
 *     responses:
 *       200:
 *         description: Loans fetched successfully
 *   delete:
 *     tags:
 *       - Loans
 *     summary: Soft Delete Loan Application
 *     description: Soft delete a loan application by setting isActive to false
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Loan application ID
 *     responses:
 *       200:
 *         description: Loan application deleted successfully
 *       404:
 *         description: Loan application not found
 *       403:
 *         description: Insufficient permissions
 *       400:
 *         description: Loan already deleted or cannot be deleted
 */

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/loans
 * Create a new loan application
 * 
 * @access FDO, BRANCH_MANAGER, AREA_MANAGER, ADMIN
 */
export async function POST(request: NextRequest) {
    return withRole(['FDO', 'BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN'], async (req, user) => {
        try {
            const body = await req.json();

            // Transform the data to match the schema
            const transformedData = {
                clientId: body.clientId,
                centerId: body.centerId,
                loanProductId: body.loanProductId,
                amount: body.amount,
                interestRate: body.interestRate,
                tenureMonths: body.tenureMonths,
                frequency: body.frequency,
                loanPurposeId: body.loanPurposeId, // Changed from purpose to loanPurposeId
                coApplicantId: body.coApplicantId || undefined,
            };

            // Validate request data
            const validationResult = loanApplicationSchema.safeParse(transformedData);

            if (!validationResult.success) {
                return errorResponse(
                    'Validation failed: ' +
                    validationResult.error.errors.map((e) => e.message).join(', '),
                    400
                );
            }

            // Create loan application
            const result = await loanService.createLoanApplication(
                validationResult.data,
                user.userId
            );

            if (!result.success) {
                return errorResponse(result.error || 'Failed to create loan application', 400);
            }

            return successResponse(
                {
                    loanId: result.loanId,
                    loanNumber: result.loanNumber,
                },
                'Loan application created successfully',
                201
            );
        } catch (error) {
            console.error('Error in loan application API:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Internal server error',
                500
            );
        }
    })(request);
}

/**
 * GET /api/loans
 * Get loans with optional filters
 * 
 * Query params:
 * - centerId: Filter by center
 * - clientId: Filter by client
 * - applicationStatus: Filter by application status
 * - disbursementStatus: Filter by disbursement status
 * - page: Page number
 * - pageSize: Items per page
 * 
 * @access All authenticated users (with role-based filtering)
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const centerId = searchParams.get('centerId');
            const clientId = searchParams.get('clientId');
            const createdById = searchParams.get('createdById');
            const applicationStatus = searchParams.get('applicationStatus');
            const disbursementStatus = searchParams.get('disbursementStatus');
            const page = parseInt(searchParams.get('page') || '1');
            const pageSize = parseInt(searchParams.get('pageSize') || '10');
            const includeInactive = searchParams.get('includeInactive') === 'true';

            // Build filters
            const filters: {
                centerId?: string;
                clientId?: string;
                branchId?: string | { in: string[] };
                createdById?: string;
                applicationStatus?: string;
                disbursementStatus?: string;
                page: number;
                pageSize: number;
                includeInactive?: boolean;
            } = {
                page,
                pageSize,
                includeInactive,
            };

            if (centerId) {
                filters.centerId = centerId;
            }

            if (clientId) {
                filters.clientId = clientId;
            }

            if (createdById) {
                filters.createdById = createdById;
            }

            // Role-based filtering
            if (user.role === 'ADMIN' || user.role === 'AREA_MANAGER') {
                // ADMIN/AREA_MANAGER can access any branch. Their "active branch" is just a UI
                // context switch, not a hard permission boundary, so when the caller already
                // scoped the request with an explicit clientId/centerId, don't additionally
                // require it to match the currently-active branch (same pattern as
                // app/api/clients/route.ts) — otherwise a loan legitimately belonging to a
                // different branch than the one currently active gets silently filtered out.
                //
                // An AREA_MANAGER assigned multiple branches (AreaManagerBranch) sees loans
                // across ALL of them, not just the currently active one; a Head Office based
                // ADMIN/AM is unrestricted (resolveScopedBranchIds returns null).
                if (!clientId && !centerId) {
                    const scopedBranchIds = await resolveScopedBranchIds(user);
                    if (scopedBranchIds !== null && scopedBranchIds.length > 0) {
                        filters.branchId = scopedBranchIds.length === 1
                            ? scopedBranchIds[0]
                            : { in: scopedBranchIds };
                    }
                }
            } else if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                if (userRecord?.branchId) {
                    filters.branchId = userRecord.branchId;
                }
            } else if (user.role === 'FDO') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: {
                        assignedCenters: {
                            select: { id: true },
                        },
                    },
                });

                if (userRecord?.assignedCenters && userRecord.assignedCenters.length > 0) {
                    const assignedCenterIds = userRecord.assignedCenters.map((c) => c.id);
                    // If centerId is provided, verify it's in assigned centers
                    if (centerId && !assignedCenterIds.includes(centerId)) {
                        return successResponse(
                            {
                                loans: [],
                                pagination: {
                                    currentPage: page,
                                    pageSize: pageSize,
                                    totalItems: 0,
                                    totalPages: 0,
                                },
                            },
                            'No loans found'
                        );
                    }
                    // If no centerId, we'll filter in the service
                }
            }

            if (applicationStatus) {
                filters.applicationStatus = applicationStatus;
            }

            if (disbursementStatus) {
                filters.disbursementStatus = disbursementStatus;
            }

            const result = await loanService.getLoans(filters);

            if (!result.success) {
                return errorResponse(result.error || 'Failed to fetch loans', 500);
            }

            return successResponse(
                {
                    loans: result.loans || [],
                    pagination: result.pagination,
                },
                'Loans fetched successfully'
            );
        } catch (error) {
            console.error('Error fetching loans:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch loans',
                500
            );
        }
    })(request);
}

/**
 * DELETE /api/loans
 * Soft delete a loan application
 */
export async function DELETE(request: NextRequest) {
    return withRole(['FDO', 'BRANCH_MANAGER', 'ADMIN'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const loanId = searchParams.get('id');

            if (!loanId) {
                return errorResponse('Loan ID is required', 400);
            }

            const loan = await prisma.loan.findFirst({
                where: {
                    id: loanId,
                    isActive: true,
                },
            });

            if (!loan) {
                return errorResponse('Loan application not found or already deleted', 404);
            }

            // Check if FDO has permission to delete this loan
            if (user.role === 'FDO') {
                const loanWithAccess = await prisma.loan.findFirst({
                    where: {
                        id: loanId,
                        createdById: user.userId,
                        isActive: true,
                    },
                });

                if (!loanWithAccess) {
                    return errorResponse('You do not have permission to delete this loan', 403);
                }
            }

            if (loan.disbursementStatus === 'DISBURSED') {
                return errorResponse('Cannot delete a disbursed loan', 400);
            }

            const deletedLoan = await prisma.loan.update({
                where: { id: loanId },
                data: {
                    isActive: false,
                    updatedAt: new Date(),
                },
                select: {
                    id: true,
                    loanNumber: true,
                    isActive: true,
                    updatedAt: true,
                },
            });

            return successResponse(
                {
                    loanId: deletedLoan.id,
                    loanNumber: deletedLoan.loanNumber,
                    isActive: deletedLoan.isActive,
                    deletedAt: deletedLoan.updatedAt,
                },
                'Loan application deleted successfully'
            );
        } catch (error) {
            console.error('Error deleting loan application:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to delete loan application',
                500
            );
        }
    })(request);
}