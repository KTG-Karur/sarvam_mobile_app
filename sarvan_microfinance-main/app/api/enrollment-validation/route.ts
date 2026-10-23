import { NextRequest } from 'next/server';
import { enrollmentValidationUpdateSchema } from '@/app/lib/validations/enrollment-validation.validation';
import { enrollmentValidationService } from '@/app/lib/services/enrollment-validation.service';
import { withRole, successResponse, errorResponse, handleCorsPreflight } from '@/app/lib/api-utils';

/**
 * OPTIONS /api/enrollment-validation
 * Handle CORS preflight requests
 */
export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/enrollment-validation
 * Get all enrollment validation configurations
 *
 * @access All authenticated users (needed by enrollment form for FDO)
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'FDO', 'AREA_MANAGER'], async (req, user) => {
        try {
            const configs = await enrollmentValidationService.getConfig();
            return successResponse(configs, 'Enrollment validation configs retrieved successfully', 200);
        } catch (error) {
            console.error('Error in enrollment validation GET API:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Internal server error',
                500
            );
        }
    })(request);
}

/**
 * POST /api/enrollment-validation
 * Update enrollment validation configurations
 *
 * Body: { updates: Array<{ fieldKey: string; isRequired: boolean }> }
 * @access ADMIN
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            // Parse request body
            const body = await req.json();

            // Validate request data
            const validationResult = enrollmentValidationUpdateSchema.safeParse(body);

            if (!validationResult.success) {
                return errorResponse(
                    'Validation failed: ' + validationResult.error.errors.map(e => e.message).join(', '),
                    400
                );
            }

            // Update configurations
            await enrollmentValidationService.upsertConfigs(validationResult.data.updates);

            // Return updated configs
            const updatedConfigs = await enrollmentValidationService.getConfig();

            return successResponse(
                updatedConfigs,
                'Enrollment validation configs updated successfully',
                200
            );
        } catch (error) {
            console.error('Error in enrollment validation POST API:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Internal server error',
                500
            );
        }
    })(request);
}
