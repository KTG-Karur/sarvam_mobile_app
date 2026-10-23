import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import * as XLSX from 'xlsx';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// POST /api/economic-activities/upload
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const formData = await request.formData();
            const file = formData.get('file') as File;
            const economicActivityTypeId = formData.get('economicActivityTypeId') as string;

            if (!file) {
                return errorResponse('No file provided', 400);
            }

            if (!economicActivityTypeId) {
                return errorResponse('Economic activity type ID is required', 400);
            }

            // Verify type exists
            const activityType = await prisma.economicActivityType.findUnique({
                where: { id: economicActivityTypeId },
            });

            if (!activityType) {
                return errorResponse('Economic activity type not found', 404);
            }

            // Read Excel file
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(worksheet) as any[];

            if (!rows || rows.length === 0) {
                return errorResponse('Excel file is empty', 400);
            }

            let totalCreated = 0;
            let totalNotCreated = 0;

            // Process each row
            for (const row of rows) {
                const name = row['Activity Name'] || row['name'] || row['Name'];
                if (!name || !String(name).trim()) continue;

                const normalizedName = String(name).trim();

                // Check for duplicate within this type
                const existing = await prisma.economicActivity.findFirst({
                    where: {
                        name: {
                            equals: normalizedName,
                            mode: 'insensitive',
                        },
                        economicActivityTypeId,
                        isActive: true,
                    },
                });

                if (!existing) {
                    // Generate next activityId
                    const existingActivities = await prisma.economicActivity.findMany({
                        select: { activityId: true },
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                    });

                    let nextNumber = 1;
                    if (existingActivities.length > 0) {
                        const match = existingActivities[0].activityId.match(/ACTIVITY-(\d+)/);
                        if (match) {
                            nextNumber = parseInt(match[1], 10) + 1;
                        }
                    }
                    const activityId = `ACTIVITY-${String(nextNumber).padStart(4, '0')}`;

                    // Create new activity
                    await prisma.economicActivity.create({
                        data: {
                            activityId,
                            name: normalizedName,
                            economicActivityTypeId,
                            isActive: true,
                        },
                    });
                    totalCreated++;
                } else {
                    totalNotCreated++;
                }
            }

            if (totalCreated > 0) {
                await bumpMasterDataVersion('economicActivities');
                await bumpMasterDataVersion('economicActivityTypes');
            }
            return successResponse(
                {
                    totalUploaded: rows.length,
                    totalCreated,
                    totalNotCreated,
                },
                'Economic activities uploaded successfully'
            );
        } catch (error) {
            console.error('Error uploading economic activities:', error);
            return errorResponse('Failed to upload file', 500);
        }
    })(request);
}
