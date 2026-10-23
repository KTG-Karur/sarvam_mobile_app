import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { withAuth, withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import {
    DEFAULT_LOAN_ADVANCE_ENABLED,
    invalidateLoanAdvanceConfigCache,
} from '@/app/lib/loan-advance-config';

const configSchema = z.object({ enabled: z.boolean() });

export async function GET(request: NextRequest) {
    return withAuth(async () => {
        try {
            const config = await prisma.loanAdvanceConfig.findFirst();
            return successResponse(
                { enabled: config?.enabled ?? DEFAULT_LOAN_ADVANCE_ENABLED },
                'Loan Advance setting retrieved'
            );
        } catch (error) {
            console.error('Error fetching Loan Advance setting:', error);
            return errorResponse('Failed to fetch setting', 500);
        }
    })(request);
}

export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const body = await req.json();
            const validated = configSchema.parse(body);

            const existing = await prisma.loanAdvanceConfig.findFirst();
            const result = existing
                ? await prisma.loanAdvanceConfig.update({ where: { id: existing.id }, data: validated })
                : await prisma.loanAdvanceConfig.create({ data: validated });

            invalidateLoanAdvanceConfigCache();

            return successResponse(result, 'Loan Advance setting saved');
        } catch (error: unknown) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            return errorResponse((error as Error).message || 'Failed to save setting', 500);
        }
    })(request);
}

export async function OPTIONS() {
    return handleCorsPreflight();
}
