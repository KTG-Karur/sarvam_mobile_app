import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/db';
import { z } from 'zod';
import { createBackupLoanFromReports } from '@/app/lib/services/backup-loan.service';
import { getLoanAdvanceEnabled } from '@/app/lib/loan-advance-config';
import {
    loanCardReportSchema,
    repaymentReportSchema,
} from '@/app/lib/validations/backup-loan-report.validation';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const goldLoanDetailSchema = z.object({
    karatType: z.enum(['24K', '22K', '20K', '18K', '16K']),
    gramCount: z.number().positive('Gram count must be positive'),
    pricePerGram: z.number().positive('Price per gram must be positive'),
    goldTakenValue: z.number().nonnegative(),
    cashGiven: z.number().nonnegative(),
});

const backupLoanSchema = z.object({
    clientId: z.string().min(1, 'Client ID is required'),
    centerId: z.string().min(1, 'Center ID is required'),
    branchId: z.string().min(1, 'Branch ID is required'),
    groupId: z.string().min(1, 'Group ID is required'),
    loanProductId: z.string().min(1, 'Loan Product ID is required'),
    loanProductTypeId: z.string().min(1, 'Loan Product Type ID is required'),
    frequency: z.enum(['daily', 'weekly', 'forthnight', 'monthly', 'quarterly']),
    loanPurposeId: z.string().min(1, 'Loan Purpose ID is required'),
    disbursementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    scheduleStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Schedule start date must be YYYY-MM-DD'),
    funderId: z.string().optional(),
    principalPaid: z.number().min(0, 'Principal paid cannot be negative').default(0),
    interestPaid: z.number().min(0, 'Interest paid cannot be negative').default(0),
    savingsPaid: z.number().min(0, 'Savings paid cannot be negative').default(0),
    goldLoanDetails: goldLoanDetailSchema.optional(),
    loanCardReport: loanCardReportSchema.optional(),
    repaymentReport: repaymentReportSchema.optional(),
});

type BackupLoanInput = z.infer<typeof backupLoanSchema>;

/**
 * POST /api/ongoing-loan-backup
 * Create a backup loan with schedule for a verified client with no active loan
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const body = await req.json();
            const validationResult = backupLoanSchema.safeParse(body);

            if (!validationResult.success) {
                return errorResponse(
                    `Validation failed: ${validationResult.error.errors.map((e) => e.message).join(', ')}`,
                    400
                );
            }

            const input: BackupLoanInput = validationResult.data;
            if (!(await getLoanAdvanceEnabled())) {
                input.savingsPaid = 0;
            }

            // Validate client exists and is verified
            const client = await prisma.client.findUnique({
                where: { id: input.clientId },
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    verificationStatus: true,
                    isActive: true,
                    centerId: true,
                },
            });

            if (!client) {
                return errorResponse('Client not found', 404);
            }

            if (client.verificationStatus !== 'VERIFIED' || !client.isActive) {
                return errorResponse('Client must be verified and active', 400);
            }

            if (client.centerId !== input.centerId) {
                return errorResponse('Client does not belong to the specified center', 400);
            }

            // Verify group membership
            const groupMember = await prisma.groupMember.findFirst({
                where: {
                    clientId: input.clientId,
                    groupId: input.groupId,
                },
            });

            if (!groupMember) {
                return errorResponse('Client is not a member of the specified group', 400);
            }

            // Check no existing DISBURSED loans with indexId (active normal loans)
            const existingActiveLoan = await prisma.loan.findFirst({
                where: {
                    clientId: input.clientId,
                    disbursementStatus: 'DISBURSED',
                    isActive: true,
                    indexId: { not: null }, // Exclude backup loans (no indexId)
                },
            });

            if (existingActiveLoan) {
                return errorResponse(
                    'Client already has an active loan. Cannot create backup for a client with active loans.',
                    400
                );
            }

            // Fetch loan product with schedule templates
            const loanProduct = await prisma.loanProduct.findUnique({
                where: { id: input.loanProductId },
                include: {
                    scheduleTemplates: { orderBy: { installmentNo: 'asc' } },
                },
            });

            if (!loanProduct) {
                return errorResponse('Loan product not found', 404);
            }

            // Create loan + schedule + transaction history in one transaction.
            // createBackupLoanFromReports uses the Loan Card Report's exact
            // schedule / Repayment Report's real event replay when provided,
            // and falls back to the generic manual-entry path when neither is.
            const result = await prisma.$transaction(async (tx) => {
                return createBackupLoanFromReports(tx, {
                    clientId: input.clientId,
                    centerId: input.centerId,
                    branchId: input.branchId,
                    loanProductId: input.loanProductId,
                    loanPurposeId: input.loanPurposeId,
                    frequency: input.frequency,
                    disbursementDate: new Date(input.disbursementDate),
                    scheduleStartDate: new Date(input.scheduleStartDate),
                    funderId: input.funderId || null,
                    principalPaid: input.principalPaid,
                    interestPaid: input.interestPaid,
                    savingsPaid: input.savingsPaid,
                    goldLoanDetails: input.goldLoanDetails,
                    createdById: user.userId,
                    loanCardReport: input.loanCardReport,
                    repaymentReport: input.repaymentReport,
                });
            });

            return successResponse(
                {
                    loanId: result.loanId,
                    loanNumber: result.loanNumber,
                    transactionId: result.transactionId,
                    message: 'Backup loan created successfully with schedule',
                },
                'Backup loan created successfully with schedule',
                201
            );
        } catch (error) {
            console.error('Error creating backup loan:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to create backup loan',
                500
            );
        }
    })(request);
}
