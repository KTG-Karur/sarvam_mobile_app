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

// POST /api/loan-purposes/upload
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const formData = await request.formData();
            const file = formData.get('file') as File;
            const loanPurposeTypeId = formData.get('loanPurposeTypeId') as string;

            if (!file) {
                return errorResponse('No file provided', 400);
            }

            if (!loanPurposeTypeId) {
                return errorResponse('Loan purpose type ID is required', 400);
            }

            // Verify type exists
            const purposeType = await prisma.loanPurposeType.findUnique({
                where: { id: loanPurposeTypeId },
            });

            if (!purposeType) {
                return errorResponse('Loan purpose type not found', 404);
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
                const name = row['Purpose Name'] || row['name'] || row['Name'];
                if (!name || !String(name).trim()) continue;

                const normalizedName = String(name).trim();

                // Check for duplicate within this type
                const existing = await prisma.loanPurpose.findFirst({
                    where: {
                        name: {
                            equals: normalizedName,
                            mode: 'insensitive',
                        },
                        loanPurposeTypeId,
                        isActive: true,
                    },
                });

                if (!existing) {
                    // Generate next purposeId
                    const existingPurposes = await prisma.loanPurpose.findMany({
                        select: { purposeId: true },
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                    });

                    let nextNumber = 1;
                    if (existingPurposes.length > 0) {
                        const match = existingPurposes[0].purposeId.match(/PURPOSE-(\d+)/);
                        if (match) {
                            nextNumber = parseInt(match[1], 10) + 1;
                        }
                    }
                    const purposeId = `PURPOSE-${String(nextNumber).padStart(4, '0')}`;

                    // Create new purpose
                    await prisma.loanPurpose.create({
                        data: {
                            purposeId,
                            name: normalizedName,
                            loanPurposeTypeId,
                            isActive: true,
                        },
                    });
                    totalCreated++;
                } else {
                    totalNotCreated++;
                }
            }

            if (totalCreated > 0) {
                await bumpMasterDataVersion('loanPurposes');
                await bumpMasterDataVersion('loanPurposeTypes');
            }
            return successResponse(
                {
                    totalUploaded: rows.length,
                    totalCreated,
                    totalNotCreated,
                },
                'Loan purposes uploaded successfully'
            );
        } catch (error) {
            console.error('Error uploading loan purposes:', error);
            return errorResponse('Failed to upload file', 500);
        }
    })(request);
}
