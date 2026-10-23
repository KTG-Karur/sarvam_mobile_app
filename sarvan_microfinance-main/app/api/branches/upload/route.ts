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

async function generateBranchCode() {
    const lastBranch = await prisma.branch.findFirst({
        where: {
            code: {
                startsWith: 'BR',
            },
        },
        orderBy: {
            code: 'desc',
        },
    });

    if (!lastBranch) {
        return 'BR001';
    }

    const lastCode = lastBranch.code;
    const match = lastCode.match(/BR(\d+)/);

    if (!match) {
        return 'BR' + Math.random().toString(36).substring(2, 5).toUpperCase();
    }

    const nextNumber = parseInt(match[1], 10) + 1;
    return `BR${nextNumber.toString().padStart(3, '0')}`;
}

export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const formData = await request.formData();
            const file = formData.get('file') as File;

            if (!file) {
                return errorResponse('No file provided', 400);
            }

            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(worksheet) as any[];

            if (!rows || rows.length === 0) {
                return errorResponse('Excel file is empty', 400);
            }

            let totalCreated = 0;
            let totalNotCreated = 0;

            for (const row of rows) {
                const name = row['Branch Name'] || row['name'] || row['Name'];
                const code = row['Branch Code'] || row['code'] || row['Code'];
                const address = row['Address'] || row['address'];

                if (!name || !String(name).trim()) {
                    totalNotCreated++;
                    continue;
                }

                const normalizedName = String(name).trim();
                const normalizedCode = code ? String(code).trim().toUpperCase() : null;

                if (normalizedName.toLowerCase() === 'head office' || normalizedCode === 'HO') {
                    totalNotCreated++;
                    continue;
                }

                const existingByName = await prisma.branch.findFirst({
                    where: {
                        name: {
                            equals: normalizedName,
                            mode: 'insensitive',
                        },
                    },
                });

                if (existingByName) {
                    totalNotCreated++;
                    continue;
                }

                let finalCode = normalizedCode;
                if (!finalCode) {
                    finalCode = await generateBranchCode();
                } else {
                    const existingByCode = await prisma.branch.findUnique({
                        where: { code: finalCode },
                    });
                    if (existingByCode) {
                        totalNotCreated++;
                        continue;
                    }
                }

                await prisma.branch.create({
                    data: {
                        name: normalizedName,
                        code: finalCode,
                        address: address ? String(address).trim() : null,
                        isActive: true,
                    },
                });
                totalCreated++;
            }

            if (totalCreated > 0) await bumpMasterDataVersion('branches');
            return successResponse(
                {
                    totalUploaded: rows.length,
                    totalCreated,
                    totalNotCreated,
                },
                'Branches uploaded successfully'
            );
        } catch (error) {
            console.error('Error uploading branches:', error);
            return errorResponse('Failed to upload file', 500);
        }
    })(request);
}
