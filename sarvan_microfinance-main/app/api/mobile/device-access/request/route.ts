import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { comparePassword } from '@/app/lib/auth';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import * as z from 'zod';

const requestSchema = z.object({
  employeeId: z.string().min(1, 'Employee ID is required'),
  password: z.string().min(1, 'Password is required'),
  deviceId: z.string().min(1, 'Device ID is required'),
  deviceName: z.string().optional(),
});

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validationResult = requestSchema.safeParse(body);

    if (!validationResult.success) {
      const firstError = validationResult.error.errors[0];
      return errorResponse(firstError?.message || 'Invalid input', 400);
    }

    const { employeeId, password, deviceId, deviceName } = validationResult.data;

    const user = await prisma.user.findUnique({ where: { employeeId } });

    if (!user) {
      return errorResponse('Invalid Employee ID or password', 401);
    }

    if (!user.isActive) {
      return errorResponse('Account is inactive. Please contact administrator.', 403);
    }

    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid) {
      return errorResponse('Invalid Employee ID or password', 401);
    }

    // Check if there is already a PENDING request for this device
    const existingPending = await prisma.deviceAccessRequest.findFirst({
      where: {
        userId: user.id,
        deviceId,
        status: 'PENDING',
      },
    });

    if (existingPending) {
      return successResponse(
        { request: existingPending },
        'A device access request for this device is already pending Admin approval.'
      );
    }

    // Create a new PENDING device access request
    const deviceReq = await prisma.deviceAccessRequest.create({
      data: {
        userId: user.id,
        employeeId: user.employeeId ?? employeeId,
        deviceId,
        deviceName: deviceName || 'Mobile Device',
        status: 'PENDING',
      },
    });

    return successResponse(
      { request: deviceReq },
      'Device access request submitted successfully. Please contact your Admin for approval.'
    );
  } catch (error) {
    console.error('Error submitting device access request:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}
