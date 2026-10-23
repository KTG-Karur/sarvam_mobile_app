import { NextRequest } from 'next/server';
import { handleCorsPreflight, withAuth, withRole, successResponse, errorResponse } from '@/app/lib/api-utils';

/**
 * Example API route showing how to use the utilities for mobile app compatibility
 * 
 * This route demonstrates:
 * 1. CORS support (OPTIONS handler)
 * 2. Authentication via Authorization header (mobile) or cookies (web)
 * 3. Role-based access control
 */

// Handle CORS preflight requests (required for mobile apps)
export async function OPTIONS() {
  return handleCorsPreflight();
}

// Public endpoint - no authentication required
export async function GET(request: NextRequest) {
  return successResponse({
    message: 'This is a public endpoint',
    timestamp: new Date().toISOString(),
  });
}

// Protected endpoint - requires authentication
export async function POST(request: NextRequest) {
  return withAuth(async (req, user) => {
    const body = await req.json();
    
    return successResponse({
      message: 'Authenticated request successful',
      user: {
        id: user.userId,
        email: user.email,
        role: user.role,
      },
      receivedData: body,
    });
  })(request);
}

// Role-based endpoint - only ADMIN and BRANCH_MANAGER can access
export async function PUT(request: NextRequest) {
  return withRole(
    ['ADMIN', 'BRANCH_MANAGER'],
    async (req, user) => {
      const body = await req.json();
      
      return successResponse({
        message: 'Role-based access successful',
        user: {
          id: user.userId,
          email: user.email,
          role: user.role,
        },
        data: body,
      });
    }
  )(request);
}
