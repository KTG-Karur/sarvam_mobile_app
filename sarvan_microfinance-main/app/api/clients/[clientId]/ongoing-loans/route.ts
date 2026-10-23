import { NextRequest } from 'next/server';
import { withAuth, errorResponse, successResponse } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { getOngoingLoansByClientIds } from '@/app/lib/services/ongoing-loans.service';

export async function GET(request: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  return withAuth(async (req, user) => {
    try {
      const { clientId } = await params;

      const client = await prisma.client.findUnique({
        where: { id: clientId },
      });

      if (!client) {
        return errorResponse('Client not found', 404);
      }

      const ongoingLoansByClient = await getOngoingLoansByClientIds([client.id]);
      const formattedLoans = ongoingLoansByClient[client.id] || [];

      if (formattedLoans.length === 0) {
        return successResponse([], 'No ongoing loans found');
      }

      return successResponse(formattedLoans, 'Ongoing loans fetched successfully');
    } catch (error: any) {
      console.error('[GET /api/clients/[clientId]/ongoing-loans]', error);
      return errorResponse(error.message || 'Failed to fetch ongoing loans', 500);
    }
  })(request);
}
