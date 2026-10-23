import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const DeathMarkingSchema = z.object({
    deceasedPersonType:  z.enum(['MEMBER', 'CO_APPLICANT'], { required_error: 'Deceased person type is required' }),
    deceasedPersonName:  z.string().min(1, 'Deceased person name is required'),
    deathReason:         z.string().min(1, 'Death reason is required'),
    deathDate:           z.string().min(1, 'Death date is required'),
    placeOfDeath:        z.string().min(1, 'Place of death is required'),
    demandRequired:      z.boolean().default(false),
    deathCertificateUrl: z.string().min(1, 'Death certificate is required'),
    deathCertificateName: z.string().min(1, 'Certificate file name is required'),
});

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    return withAuth(async (_req, _user) => {
        try {
            const { loanId } = await params;
            if (!loanId) return errorResponse('Loan ID is required', 400);

            const record = await prisma.loanDeathMarking.findFirst({
                where: { loanId, isReversed: false },
            });

            return successResponse({ deathMarking: record ?? null }, 'Fetched');
        } catch (error: any) {
            return errorResponse(error.message || 'Failed to fetch death marking', 500);
        }
    })(request);
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    return withRole(['ADMIN', 'BRANCH_MANAGER'], async (req, user) => {
        try {
            const { loanId } = await params;
            if (!loanId) return errorResponse('Loan ID is required', 400);

            const body = await req.json();
            const data = DeathMarkingSchema.parse(body);

            const existing = await prisma.loanDeathMarking.findFirst({
                where: { loanId, isReversed: false },
            });
            if (existing) {
                return errorResponse('Death marking already exists for this loan', 409);
            }

            const loan = await prisma.loan.findUnique({
                where: { id: loanId },
                select: { id: true, clientId: true },
            });
            if (!loan) return errorResponse('Loan not found', 404);

            const record = await prisma.loanDeathMarking.create({
                data: {
                    loanId,
                    clientId:            loan.clientId,
                    deceasedPersonType:  data.deceasedPersonType,
                    deceasedPersonName:  data.deceasedPersonName,
                    deathReason:         data.deathReason,
                    deathDate:           new Date(data.deathDate),
                    placeOfDeath:        data.placeOfDeath,
                    demandRequired:      data.demandRequired,
                    deathCertificateUrl: data.deathCertificateUrl,
                    deathCertificateName: data.deathCertificateName,
                    createdById:         user.userId,
                },
            });

            return successResponse(record, 'Death marking created successfully');
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            return errorResponse(error.message || 'Failed to create death marking', 500);
        }
    })(request);
}
