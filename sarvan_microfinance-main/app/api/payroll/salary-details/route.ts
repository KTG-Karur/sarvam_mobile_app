import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { z } from 'zod';

const salaryComponentSchema = z.object({
    id: z.string().optional(),
    salaryId: z.number().min(1, 'Salary Id is required'),
    name: z.string().min(1, 'Salary Name is required'),
    type: z.enum(['EARNINGS', 'DEDUCTIONS']),
    // Optional — a percentage-based deduction (e.g. PF, ESI). Null/omitted
    // keeps the component a flat manually-entered amount, unchanged from
    // before. Both must be set together, or both left unset.
    defaultPercent: z.number().min(0).max(100).optional().nullable(),
    percentBasis: z.enum(['BASIC', 'GROSS']).optional().nullable(),
    // Optional ceiling on the percentage-computed amount (e.g. PF max ₹1,800).
    // Null/omitted = no cap. Only allowed alongside a Default %.
    maxAmount: z.number().positive('Maximum Amount must be greater than 0').optional().nullable(),
    // Optional: 0 deduction when the employee's Month CTC Pay is above this
    // (e.g. ESI only up to 21,000). Null/omitted = applies at any CTC.
    ctcEligibilityLimit: z.number().positive('CTC limit must be greater than 0').optional().nullable(),
}).refine(
    (data) => (data.defaultPercent == null) === (data.percentBasis == null),
    { message: 'Default % and Basis must both be set, or both left blank', path: ['percentBasis'] }
).refine(
    (data) => data.maxAmount == null || data.defaultPercent != null,
    { message: 'Maximum Amount needs a Default % to cap', path: ['maxAmount'] }
).refine(
    (data) => data.ctcEligibilityLimit == null || data.defaultPercent != null,
    { message: 'CTC limit needs a Default %', path: ['ctcEligibilityLimit'] }
);

export async function GET(request: NextRequest) {
    return withAuth(async () => {
        try {
            const components = await prisma.$queryRawUnsafe(
                'SELECT * FROM "salary_components" WHERE "isActive" = true ORDER BY "salaryId" ASC'
            );
            return successResponse(components, 'Salary components fetched successfully');
        } catch (error: any) {
            console.error('Error fetching salary components:', error);
            return errorResponse(error.message || 'Failed to fetch salary components', 500);
        }
    })(request);
}

export async function POST(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const body = await req.json();
            const validation = salaryComponentSchema.safeParse(body);
            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }

            const { id, salaryId, name, type, defaultPercent, percentBasis, maxAmount, ctcEligibilityLimit } = validation.data;

            // Cleanup inactive records that might conflict with this new/updated entry
            // This allows reusing SalaryId or Name from previously "deleted" components
            await prisma.$executeRawUnsafe(
                'DELETE FROM "salary_components" WHERE ("salaryId" = $1 OR "name" = $2) AND "isActive" = false',
                salaryId, name
            );

            if (id) {
                // Update existing
                await prisma.$executeRawUnsafe(
                    `UPDATE "salary_components"
                     SET "salaryId" = $1, "name" = $2, "type" = $3::"SalaryComponentType", "defaultPercent" = $4, "percentBasis" = $5::"SalaryPercentBasis", "maxAmount" = $6, "ctcEligibilityLimit" = $7, "updatedAt" = NOW()
                     WHERE "id" = $8`,
                    salaryId, name, type, defaultPercent ?? null, percentBasis ?? null, maxAmount ?? null, ctcEligibilityLimit ?? null, id
                );
                return successResponse(null, 'Salary component updated successfully');
            } else {
                // Create new
                const newId = crypto.randomUUID();
                await prisma.$executeRawUnsafe(
                    `INSERT INTO "salary_components" ("id", "salaryId", "name", "type", "isActive", "defaultPercent", "percentBasis", "maxAmount", "ctcEligibilityLimit", "createdAt", "updatedAt")
                     VALUES ($1, $2, $3, $4::"SalaryComponentType", true, $5, $6::"SalaryPercentBasis", $7, $8, NOW(), NOW())`,
                    newId, salaryId, name, type, defaultPercent ?? null, percentBasis ?? null, maxAmount ?? null, ctcEligibilityLimit ?? null
                );
                return successResponse(null, 'Salary component created successfully');
            }
        } catch (error: any) {
            console.error('Error saving salary component:', error);
            const errorMessage = error.message || '';
            if (errorMessage.includes('unique constraint') || errorMessage.includes('already exists') || error.code === '23505' || errorMessage.includes('P2002')) {
                return errorResponse('Salary Id or Name already exists in the records', 400);
            }
            return errorResponse(errorMessage || 'Failed to save salary component', 500);
        }
    })(request);
}

export async function DELETE(request: NextRequest) {
    return withAuth(async () => {
        try {
            const { searchParams } = new URL(request.url);
            const id = searchParams.get('id');

            if (!id) {
                return errorResponse('Component ID is required', 400);
            }

            // Hard delete to allow reuse of ID/Name
            await prisma.$executeRawUnsafe(
                'DELETE FROM "salary_components" WHERE "id" = $1',
                id
            );

            return successResponse(null, 'Salary component deleted successfully');
        } catch (error: any) {
            console.error('Error deleting salary component:', error);
            return errorResponse(error.message || 'Failed to deactivate salary component', 500);
        }
    })(request);
}
