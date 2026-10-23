import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse } from '@/app/lib/api-utils';
import { z } from 'zod';

// Ensure this matches your project's withAuth signature. 
// If withAuth is not exported or different, adjust accordingly.
// Assuming it is default export or named export from api-utils based on previous file.
import { withAuth } from '@/app/lib/api-utils';

const createSelfAccountSchema = z.object({
    name: z.string().min(1, "Account Name is required"),
    description: z.string().optional(),
    type: z.enum(['CASH', 'BANK'], {
        errorMap: () => ({ message: 'Type is required and must be CASH or BANK' }),
    }),
});

const selfAccountTypeQuerySchema = z.enum(['CASH', 'BANK']).optional();

/**
 * GET /api/accounts/self
 * Fetch all self accounts
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const typeParam = searchParams.get('type') ?? undefined;
            const parsedType = selfAccountTypeQuerySchema.safeParse(typeParam);
            if (!parsedType.success) {
                return errorResponse('Invalid type filter. Expected CASH or BANK.', 400);
            }

            const accounts = await prisma.selfAccount.findMany({
                where: {
                    isActive: true, // Assuming soft delete logic
                    ...(parsedType.data ? { type: parsedType.data } : {}),
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });

            return successResponse(accounts, 'Self accounts fetched successfully');
        } catch (error) {
            console.error('Error fetching self accounts:', error);
            return errorResponse('Failed to fetch self accounts', 500);
        }
    })(request);
}

/**
 * POST /api/accounts/self
 * Create a new self account
 */
export async function POST(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const body = await req.json();

            const validation = createSelfAccountSchema.safeParse(body);
            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }

            const { name, description, type } = validation.data;

            // Check if name already exists
            const existing = await prisma.selfAccount.findFirst({
                where: {
                    name: { equals: name, mode: 'insensitive' },
                    isActive: true,
                },
            });

            if (existing) {
                return errorResponse(`Account with name "${name}" already exists`, 409);
            }

            const newAccount = await prisma.selfAccount.create({
                data: {
                    name,
                    description,
                    type,
                },
            });

            return successResponse(newAccount, 'Self account created successfully', 201);
        } catch (error) {
            console.error('Error creating self account:', error);
            return errorResponse('Failed to create self account', 500);
        }
    })(request);
}
