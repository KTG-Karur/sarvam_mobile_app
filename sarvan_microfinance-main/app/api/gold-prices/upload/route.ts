import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const uploadRecordSchema = z.object({
    priceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'priceDate must be YYYY-MM-DD'),
    k24Price: z.number().positive('k24 price must be positive'),
    k22Price: z.number().positive('k22 price must be positive'),
    k20Price: z.number().positive('k20 price must be positive'),
    k18Price: z.number().positive('k18 price must be positive'),
    k16Price: z.number().positive('k16 price must be positive'),
});

const uploadSchema = z.array(uploadRecordSchema).min(1, 'At least one record is required');

// POST /api/gold-prices/upload — bulk upload gold prices from Excel/CSV import
export async function POST(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER'], async (req, user) => {
        try {
            const branchId = user.branchId;
            if (!branchId) return errorResponse('Branch context is required', 400);

            const body = await req.json();
            const records = uploadSchema.parse(body);

            // Parse all dates once
            const parsed = records.map((record) => ({
                ...record,
                priceDate: new Date(record.priceDate + 'T00:00:00.000Z'),
            }));

            // Find the latest date in the batch to mark as active
            const latestTime = Math.max(...parsed.map((r) => r.priceDate.getTime()));

            const created = await prisma.$transaction(async (tx) => {
                const results = [];

                for (const record of parsed) {
                    const isLatest = record.priceDate.getTime() === latestTime;

                    // Deactivate any existing active price for this branch on the same date
                    await tx.goldPrice.updateMany({
                        where: { branchId, priceDate: record.priceDate, isActive: true },
                        data: { isActive: false },
                    });

                    const price = await tx.goldPrice.create({
                        data: {
                            branchId,
                            priceDate: record.priceDate,
                            k24Price: record.k24Price,
                            k22Price: record.k22Price,
                            k20Price: record.k20Price,
                            k18Price: record.k18Price,
                            k16Price: record.k16Price,
                            isActive: isLatest,
                            createdById: user.userId,
                        },
                    });

                    results.push(price);
                }

                return results;
            });

            return successResponse(
                { count: created.length, records: created },
                `${created.length} gold price record(s) uploaded successfully`,
                201
            );
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error uploading gold prices:', error);
            return errorResponse(error.message || 'Failed to upload gold prices', 500);
        }
    })(request);
}
