import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';

/**
 * @swagger
 * /api/loans/check-frequency:
 *   get:
 *     tags:
 *       - Loans
 *     summary: Check center pipeline loans (informational)
 *     description: Reports unverified loans in a center. Frequency is per-loan; requiredFrequency is always null.
 *     parameters:
 *       - in: query
 *         name: centerId
 *         required: true
 *         schema:
 *           type: string
 *         description: Center ID to check
 *     responses:
 *       200:
 *         description: Frequency check result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 hasUnverifiedLoans:
 *                   type: boolean
 *                 requiredFrequency:
 *                   type: string
 *                   nullable: true
 *                 unverifiedLoanNumber:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       400:
 *         description: Invalid request
 */

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/loans/check-frequency
 * Informational: unverified loans in center. No frequency lock — each loan carries its own frequency.
 *
 * @access All authenticated users
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const centerId = searchParams.get('centerId');

            if (!centerId) {
                return errorResponse('Center ID is required', 400);
            }

            // Check for unverified loans in this center
            const unverifiedLoans = await prisma.loan.findMany({
                where: {
                    centerId,
                    isActive: true,
                    applicationStatus: {
                        in: ['DRAFT', 'PENDING_VERIFICATION'],
                    },
                },
                select: {
                    id: true,
                    loanNumber: true,
                    frequency: true,
                    applicationStatus: true,
                },
                orderBy: {
                    createdAt: 'desc',
                },
                take: 1, // Only need the most recent one
            });

            const hasUnverifiedLoans = unverifiedLoans.length > 0;
            const unverifiedLoanNumber = hasUnverifiedLoans ? unverifiedLoans[0].loanNumber : null;

            let message = '';
            if (hasUnverifiedLoans) {
                message = `Center has pipeline loan(s) not yet verified (e.g. ${unverifiedLoanNumber}). You may still choose any repayment frequency per new loan.`;
            } else {
                message = 'No pipeline loans pending verification in this center.';
            }

            return successResponse(
                {
                    hasUnverifiedLoans,
                    requiredFrequency: null as string | null,
                    unverifiedLoanNumber,
                    message,
                },
                'Frequency check completed'
            );
        } catch (error) {
            console.error('Error checking loan frequency:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to check loan frequency',
                500
            );
        }
    })(request);
}
