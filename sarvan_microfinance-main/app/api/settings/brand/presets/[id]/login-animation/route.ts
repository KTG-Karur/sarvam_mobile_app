import { NextRequest } from 'next/server';
import {
  withRole,
  errorResponse,
  successResponse,
  handleCorsPreflight,
  jsonResponse,
} from '@/app/lib/api-utils';
import {
  getCustomLoginAnimationByPresetId,
  saveCustomLoginAnimationForPreset,
  deleteCustomLoginAnimationForPreset,
} from '@/app/lib/services/custom-login-animation.service';

/**
 * GET /api/settings/brand/presets/[id]/login-animation
 * Retrieves the custom declarative animation manifest belonging exclusively to this ThemePreset.
 * Accessible for login playback and preset inspection.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return errorResponse('Theme preset ID is required', 400);
    }

    const animation = await getCustomLoginAnimationByPresetId(id);
    if (!animation) {
      return errorResponse(`No custom login animation found for theme preset '${id}'`, 404);
    }

    return successResponse(animation, 'Custom login animation retrieved');
  } catch (error: any) {
    console.error('Error retrieving theme login animation:', error);
    return errorResponse(error.message || 'Failed to retrieve theme login animation', 500);
  }
}

/**
 * POST /api/settings/brand/presets/[id]/login-animation
 * Uploads or replaces the single custom login animation for this ThemePreset.
 * Restricted to ADMIN role.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  return withRole(['ADMIN'], async (req) => {
    try {
      if (!id) {
        return errorResponse('Theme preset ID is required', 400);
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return errorResponse('Invalid JSON payload in request body', 400);
      }

      const result = await saveCustomLoginAnimationForPreset(id, body);

      if (!result.success) {
        return jsonResponse(
          {
            success: false,
            error: result.error,
            data: { issues: result.issues } as any,
          },
          400
        );
      }

      return successResponse(
        result.data,
        'Custom login animation uploaded and assigned to theme successfully',
        201
      );
    } catch (error: any) {
      console.error('Error uploading theme login animation:', error);
      return errorResponse(error.message || 'Failed to process animation manifest', 500);
    }
  })(request);
}

/**
 * DELETE /api/settings/brand/presets/[id]/login-animation
 * Removes the custom login animation from this ThemePreset.
 * Restricted to ADMIN role.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  return withRole(['ADMIN'], async () => {
    try {
      if (!id) {
        return errorResponse('Theme preset ID is required', 400);
      }

      const deleted = await deleteCustomLoginAnimationForPreset(id);
      if (!deleted) {
        return errorResponse(`No custom login animation found to remove for theme preset '${id}'`, 404);
      }

      return successResponse(
        { themePresetId: id },
        'Custom login animation removed successfully'
      );
    } catch (error: any) {
      console.error('Error deleting theme login animation:', error);
      return errorResponse(error.message || 'Failed to remove theme login animation', 500);
    }
  })(request);
}

export async function OPTIONS() {
  return handleCorsPreflight();
}
