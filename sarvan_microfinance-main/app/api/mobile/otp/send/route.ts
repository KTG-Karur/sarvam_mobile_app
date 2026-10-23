import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { errorResponse, handleCorsPreflight, successResponse } from '@/app/lib/api-utils';

export const otpChallenges = new Map<string, { expiresAt: number; deviceId: string; otp?: string }>();
const DUMMY_OTP = '1234';

export async function OPTIONS() { return handleCorsPreflight(); }

export async function POST(request: NextRequest) {
  try {
    const { destination, purpose, deviceId } = await request.json();
    if (!destination || !purpose || !deviceId) return errorResponse('Destination, purpose and device ID are required', 400);
    const challengeId = randomUUID();
    otpChallenges.set(challengeId, { deviceId, expiresAt: Date.now() + 10 * 60 * 1000, otp: DUMMY_OTP });
    return successResponse({ challengeId, otp: DUMMY_OTP }, 'Development OTP generated. Use 1234.');
  } catch { return errorResponse('Invalid OTP request', 400); }
}
