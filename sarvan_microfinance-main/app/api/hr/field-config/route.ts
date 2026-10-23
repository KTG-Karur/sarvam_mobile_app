import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth, withRole } from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const fieldConfigSchema = z.object({
    fieldKey: z.string().min(1),
    fieldLabel: z.string().min(1),
    section: z.string().min(1),
    isRequired: z.boolean().optional(),
    isAlwaysRequired: z.boolean().optional(),
    isVisibleToEmployee: z.boolean().optional(),
});

// GET /api/hr/field-config
export async function GET(request: NextRequest) {
    return withAuth(async () => {
        try {
            const configs = await prisma.employeeFieldConfig.findMany({
                orderBy: [{ section: 'asc' }, { fieldLabel: 'asc' }],
            });
            return successResponse(configs, 'Field configs fetched successfully');
        } catch (error: any) {
            console.error('Error fetching field configs:', error);
            return errorResponse(error.message || 'Failed to fetch field configs', 500);
        }
    })(request);
}

// POST /api/hr/field-config — create or upsert a field's config by fieldKey
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const body = await req.json();
            const data = fieldConfigSchema.parse(body);

            // upsert() would otherwise let a POST to an existing, locked
            // fieldKey silently overwrite it — the same guard PUT already
            // enforces for updates has to apply here too.
            const existing = await prisma.employeeFieldConfig.findUnique({ where: { fieldKey: data.fieldKey } });
            if (existing?.isAlwaysRequired) {
                return errorResponse('This field is locked and cannot be reconfigured', 400);
            }

            const config = await prisma.employeeFieldConfig.upsert({
                where: { fieldKey: data.fieldKey },
                create: data,
                update: data,
            });

            return successResponse(config, 'Field config saved successfully', 201);
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error saving field config:', error);
            return errorResponse(error.message || 'Failed to save field config', 500);
        }
    })(request);
}

// PUT /api/hr/field-config?id= — toggle an existing config
export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const id = searchParams.get('id');
            if (!id) return errorResponse('Field config ID is required', 400);

            const existing = await prisma.employeeFieldConfig.findUnique({ where: { id } });
            if (!existing) return errorResponse('Field config not found', 404);
            if (existing.isAlwaysRequired) {
                return errorResponse('This field is locked and cannot be reconfigured', 400);
            }

            const body = await req.json();
            const data = fieldConfigSchema.partial().parse(body);

            const config = await prisma.employeeFieldConfig.update({ where: { id }, data });
            return successResponse(config, 'Field config updated successfully');
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error updating field config:', error);
            return errorResponse(error.message || 'Failed to update field config', 500);
        }
    })(request);
}
