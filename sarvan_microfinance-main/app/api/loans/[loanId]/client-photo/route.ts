import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withAuth, errorResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ loanId: string }> },
) {
  return withAuth(async (_req, user) => {
    try {
      const { loanId } = await params;
      if (!loanId) return errorResponse('Loan ID is required', 400);

      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
        select: {
          id: true,
          clientId: true,
          centerId: true,
          branchId: true,
          center: { select: { fdoId: true, branchId: true } },
        },
      });

      if (!loan) return errorResponse('Loan not found', 404);

      // Authorization: mirror the schedule endpoint logic (center-based for FDO, branch-based for BM/ADMIN/AM)
      if (user.role === 'FDO') {
        const assignedCenter = await prisma.user.findUnique({
          where: { id: user.userId },
          select: {
            assignedCenters: {
              where: { id: loan.centerId },
              select: { id: true },
            },
          },
        });

        const isAllowedByFdoId = loan.center?.fdoId === user.userId;
        const isAllowedByAssignment = (assignedCenter?.assignedCenters.length ?? 0) > 0;
        if (!isAllowedByFdoId && !isAllowedByAssignment) {
          return errorResponse('Unauthorized', 403);
        }
      }

      // Role-agnostic branch check for everyone else (this route uses withAuth,
      // so any role — including a custom RBAC one — may reach it; ADMIN/HO users
      // are unrestricted via a null permitted set).
      if (user.role !== 'FDO') {
        const permittedBranchIds = await getPermittedBranchIds(user);
        if (permittedBranchIds !== null && !permittedBranchIds.includes(loan.branchId)) {
          return errorResponse('Unauthorized', 403);
        }
      }

      const photo = await prisma.kYC.findFirst({
        where: {
          clientId: loan.clientId,
          documentType: 'client_photo',
          isDeleted: false,
          fileUrl: { not: null },
        },
        select: { fileUrl: true, mimeType: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!photo?.fileUrl) {
        return errorResponse('Client photo not found', 404);
      }

      const upstream = await fetch(photo.fileUrl);
      if (!upstream.ok) {
        return errorResponse('Failed to fetch client photo', 502);
      }

      const contentType =
        photo.mimeType ||
        upstream.headers.get('content-type') ||
        'application/octet-stream';

      // Only allow image content types to prevent misuse.
      if (!contentType.toLowerCase().startsWith('image/')) {
        return errorResponse('Invalid photo content type', 400);
      }

      const bytes = await upstream.arrayBuffer();
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          // Private: avoid caching in shared proxies
          'Cache-Control': 'private, max-age=300',
        },
      });
    } catch (err) {
      console.error('Error serving client photo:', err);
      return errorResponse('Failed to serve client photo', 500);
    }
  })(request);
}

