import { NextRequest } from 'next/server';
import { clientEnrollmentSchema } from '@/app/lib/validations/client-enrollment.validation';
import { clientEnrollmentService } from '@/app/lib/services/client-enrollment.service';
import { enrollmentValidationService } from '@/app/lib/services/enrollment-validation.service';
import { ENROLLMENT_FIELD_CONFIG_MAP, ENROLLMENT_DOC_FIELD_CONFIG_MAP } from '@/app/lib/constants/enrollment-field-config-map';
import { withAuth, withRole, successResponse, errorResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { isAmAssignedToBranch } from '@/app/lib/am-branch-utils';
import { isUserAssignedToBranch } from '@/app/lib/user-branch-assignments';

/**
 * OPTIONS /api/clients/enrollment
 * Handle CORS preflight requests
 */
export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/clients/enrollment
 * Create a new client enrollment
 *
 * @access FDO, ADMIN, Sub Admin (Role.isSubAdmin roles) — Admin/Sub Admin can
 * enroll a client on behalf of any FDO; the actual center/group ownership
 * check for FDO stays exactly as strict as before (see
 * client-enrollment.service.ts's use of assertFdoOwnsCenter).
 */
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const isSubAdmin = user.role !== 'ADMIN' && await isSubAdminUser(user.userId);
            if (!['FDO', 'ADMIN'].includes(user.role) && !isSubAdmin) {
                return errorResponse('Insufficient permissions', 403);
            }

            // Parse request body
            const body = await req.json();

            // Validate request data
            const validationResult = clientEnrollmentSchema.safeParse(body);

            if (!validationResult.success) {
                return errorResponse(
                    'Validation failed: ' + validationResult.error.errors.map(e => e.message).join(', '),
                    400
                );
            }

            // Server-side counterpart to ClientEnrollmentForm.tsx's client-side
            // configErrors gate — enforces the admin's Required/Optional config even
            // if the client-side check is bypassed (direct API call, stale bundle,
            // disabled JS). Mirrors the same field list the client already checks.
            const fieldCheck = await enrollmentValidationService.assertRequiredFieldsPresent(
                ENROLLMENT_FIELD_CONFIG_MAP.map((f) => ({
                    configKey: f.configKey,
                    value: f.getValue(validationResult.data),
                    label: f.label,
                }))
            );
            if (!fieldCheck.ok) {
                return errorResponse(
                    'Validation failed: ' + fieldCheck.missing.map((label) => `${label} is required`).join(', '),
                    400
                );
            }

            const additionalDocuments: Array<{ documentType: string; fileUrl?: string }> = body.additionalDocuments || [];
            const uploadedDocTypes = new Set(
                additionalDocuments.filter((d) => d.fileUrl).map((d) => d.documentType)
            );
            // aadhaar front/back are validated separately (dedicated schema fields,
            // not part of additionalDocuments) — see client-enrollment.service.ts.
            if (validationResult.data.kyc.aadhaarFrontFileUrl) uploadedDocTypes.add('aadhaar_front');
            if (validationResult.data.kyc.aadhaarBackFileUrl) uploadedDocTypes.add('aadhaar_back');

            const docCheck = await enrollmentValidationService.assertRequiredFieldsPresent(
                ENROLLMENT_DOC_FIELD_CONFIG_MAP.map((d) => ({
                    configKey: d.configKey,
                    value: uploadedDocTypes.has(d.documentType) ? 'uploaded' : '',
                    label: d.label,
                }))
            );
            if (!docCheck.ok) {
                return errorResponse(
                    'Missing required documents: ' + docCheck.missing.join(', '),
                    400
                );
            }

            // The enrollment form's branch selector is page-local (it no longer switches
            // the session's active branch), so it sends the chosen branch explicitly.
            // Authorized exactly like POST /auth/active-branch.
            let actorBranchId = user.branchId ?? null;
            const requestedBranchId = typeof body.enrollmentBranchId === 'string' ? body.enrollmentBranchId : '';
            if (requestedBranchId && requestedBranchId !== actorBranchId) {
                const allowed =
                    user.role === 'ADMIN' ||
                    (user.role === 'AREA_MANAGER'
                        ? await isAmAssignedToBranch(user.userId, requestedBranchId)
                        : await isUserAssignedToBranch(user.userId, requestedBranchId));
                if (!allowed) return errorResponse('This branch is not assigned to your account', 403);
                actorBranchId = requestedBranchId;
            }

            // Create enrollment
            const result = await clientEnrollmentService.createEnrollment(
                validationResult.data,
                user.userId,
                body.additionalDocuments || [],
                { role: user.role, branchId: actorBranchId }
            );

            if (!result.success) {
                return errorResponse(result.error || 'Failed to create enrollment', 400);
            }

            return successResponse(
                {
                    clientId: result.clientId,
                },
                'Client enrollment created successfully',
                201
            );
        } catch (error) {
            console.error('Error in client enrollment API:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Internal server error',
                500
            );
        }
    })(request);
}

/**
 * GET /api/clients/enrollment
 * Get client enrollments
 * 
 * Query params:
 * - centerId: Filter by center
 * - status: Filter by verification status (pending, verified, rejected)
 * - includeInactive: Include inactive clients
 * 
 * @access FDO, BRANCH_MANAGER, AREA_MANAGER
 */
export async function GET(request: NextRequest) {
    return withRole(['FDO', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (req, user) => {
        try {

            // Get query parameters
            const { searchParams } = new URL(req.url);
            const centerId = searchParams.get('centerId');
            const status = searchParams.get('status');
            const includeInactive = searchParams.get('includeInactive') === 'true';

            let result;

            // If status is pending, get pending enrollments for BM
            if (status === 'pending' && (user.role === 'BRANCH_MANAGER' || user.role === 'AREA_MANAGER')) {
                // Note: branchId would need to be in JWT payload or fetched from user
                result = await clientEnrollmentService.getPendingEnrollments(undefined);
            }
            // If centerId is provided, get enrollments for that center
            else if (centerId) {
                result = await clientEnrollmentService.getEnrollmentsByCenter(
                    centerId,
                    includeInactive
                );
            }
            // Otherwise, get pending enrollments for the user's branch
            else {
                result = await clientEnrollmentService.getPendingEnrollments(undefined);
            }

            if (!result.success) {
                return errorResponse(result.error || 'Failed to fetch enrollments', 400);
            }

            return successResponse(result.data);
        } catch (error) {
            console.error('Error fetching client enrollments:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Internal server error',
                500
            );
        }
    })(request);
}
