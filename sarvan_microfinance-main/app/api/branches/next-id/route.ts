import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withAuth,
} from '@/app/lib/api-utils';

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
  return withAuth(async () => {
    try {
      const branches = await prisma.branch.findMany({ select: { code: true } });

      const maxNum = branches.reduce((max, b) => {
        if (/^\d+$/.test(b.code)) {
          const n = parseInt(b.code, 10);
          return n > max ? n : max;
        }
        return max;
      }, 0);

      const nextId = (maxNum + 1).toString();
      return successResponse({ nextId }, 'Next branch ID generated');
    } catch (error) {
      console.error('Error generating next branch ID:', error);
      return errorResponse('Failed to generate next branch ID', 500);
    }
  })(request);
}
