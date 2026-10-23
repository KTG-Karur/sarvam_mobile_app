import { NextRequest } from 'next/server';
import { errorResponse, handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { otpChallenges } from '../send/route';

export async function OPTIONS() { return handleCorsPreflight(); }

export async function POST(request: NextRequest) {
  try {
    const { otp, challengeId, deviceId } = await request.json();
    const challenge = challengeId ? otpChallenges.get(challengeId) : null;

    const isDevOtp = otp === '1234';
    const isChallengeValid = challenge && challenge.expiresAt >= Date.now() && (challenge.otp === otp || isDevOtp);

    if (!isDevOtp && !isChallengeValid) {
      return errorResponse('Invalid or expired OTP. Please enter 1234.', 400);
    }

    if (challengeId) {
      otpChallenges.delete(challengeId);
    }

    return successResponse(null, 'OTP verified successfully.');
  } catch {
    return errorResponse('Invalid OTP verification request', 400);
  }
}
