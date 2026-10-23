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

// POST /api/economic-activity-types/upload
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const formData = await request.formData();
            const file = formData.get('file') as File;

            if (!file) {
                return errorResponse('No file provided', 400);
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
                const name = row['Type Name'] || row['name'] || row['Name'];
                if (!name || !String(name).trim()) continue;

                const normalizedName = String(name).trim();

                // Check for duplicate
                const existing = await prisma.economicActivityType.findFirst({
                    where: {
                        name: {
                            equals: normalizedName,
                            mode: 'insensitive',
                        },
                        isActive: true,
                    },
                });

                if (!existing) {
                    // Generate next typeId
                    const existingTypes = await prisma.economicActivityType.findMany({
                        select: { typeId: true },
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                    });

                    let nextNumber = 1;
                    if (existingTypes.length > 0) {
                        const match = existingTypes[0].typeId.match(/ACTIVITY-TYPE-(\d+)/);
                        if (match) {
                            nextNumber = parseInt(match[1], 10) + 1;
                        }
                    }
                    const typeId = `ACTIVITY-TYPE-${String(nextNumber).padStart(4, '0')}`;

                    // Create new type
                    await prisma.economicActivityType.create({
                        data: {
                            typeId,
                            name: normalizedName,
                            isActive: true,
                        },
                    });
                    totalCreated++;
                } else {
                    totalNotCreated++;
                }
            }

            if (totalCreated > 0) {
                await bumpMasterDataVersion('economicActivityTypes');
                await bumpMasterDataVersion('economicActivities');
            }
            return successResponse(
                {
                    totalUploaded: rows.length,
                    totalCreated,
                    totalNotCreated,
                },
                'Economic activity types uploaded successfully'
            );
        } catch (error) {
            console.error('Error uploading economic activity types:', error);
            return errorResponse('Failed to upload file', 500);
        }
    })(request);
}
