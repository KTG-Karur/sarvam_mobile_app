import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { toRevertLocationDto } from '@/app/lib/revert-location';
import type { Prisma } from '@prisma/client';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/loans/death-marking/search
 * Admin-only: find loans that currently have an active death marking, for the
 * Death Revert screen. Search by member ID, phone, or Aadhaar (same three
 * modes as the write-off/closure search).
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const searchType = searchParams.get('searchType') as 'memberId' | 'phone' | 'aadhaar' | null;
            const searchValue = searchParams.get('searchValue')?.trim() ?? '';
            const statusParam = searchParams.get('status') === 'reverted' ? 'reverted' : 'active';

            if (!searchType || !['memberId', 'phone', 'aadhaar'].includes(searchType)) {
                return errorResponse('searchType must be one of: memberId, phone, aadhaar', 400);
            }
            if (!searchValue) return errorResponse('searchValue is required', 400);

            let clientWhere: Prisma.ClientWhereInput;
            if (searchType === 'memberId') {
                clientWhere = { clientId: { contains: searchValue, mode: 'insensitive' } };
            } else if (searchType === 'phone') {
                clientWhere = {
                    OR: [
                        { mobileNumber: { contains: searchValue, mode: 'insensitive' } },
                        { phone: { contains: searchValue, mode: 'insensitive' } },
                    ],
                };
            } else {
                const normalized = searchValue.replace(/\D/g, '');
                clientWhere = { otherIdNo: { contains: normalized, mode: 'insensitive' } };
            }

            const markings = await prisma.loanDeathMarking.findMany({
                where: { client: clientWhere, isReversed: statusParam === 'reverted' },
                include: {
                    loan: { select: { id: true, loanNumber: true } },
                    client: { select: { id: true, clientId: true, firstName: true, lastName: true, mobileNumber: true } },
                    revertedBy: { select: { firstName: true, lastName: true, employeeId: true } },
                },
                orderBy: statusParam === 'reverted' ? { revertedAt: 'desc' } : { createdAt: 'desc' },
            });

            if (statusParam === 'reverted') {
                const revertedRows = markings.map((m) => ({
                    loanId: m.loanId,
                    loanNumber: m.loan.loanNumber,
                    clientCode: m.client.clientId,
                    memberName: `${m.client.firstName} ${m.client.lastName}`,
                    memberPhone: m.client.mobileNumber ?? null,
                    deceasedPersonType: m.deceasedPersonType,
                    deceasedPersonName: m.deceasedPersonName,
                    deathDate: m.deathDate.toISOString(),
                    deathReason: m.deathReason,
                    revertedAt: m.revertedAt ? m.revertedAt.toISOString() : null,
                    revertedByName: m.revertedBy ? `${m.revertedBy.firstName} ${m.revertedBy.lastName}` : null,
                    revertedByEmployeeId: m.revertedBy?.employeeId ?? null,
                    revertReason: m.revertReason ?? null,
                    revertLocation: toRevertLocationDto(m),
                }));
                return successResponse(revertedRows, revertedRows.length === 0 ? 'No reverted death markings found matching the search criteria' : 'Reverted death markings fetched');
            }

            const rows = markings.map((m) => ({
                loanId: m.loanId,
                loanNumber: m.loan.loanNumber,
                clientCode: m.client.clientId,
                memberName: `${m.client.firstName} ${m.client.lastName}`,
                memberPhone: m.client.mobileNumber ?? null,
                deceasedPersonType: m.deceasedPersonType,
                deceasedPersonName: m.deceasedPersonName,
                deathDate: m.deathDate.toISOString(),
                deathReason: m.deathReason,
            }));

            return successResponse(rows, rows.length === 0 ? 'No death markings found matching the search criteria' : 'Death markings fetched');
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to search death markings';
            return errorResponse(message, 500);
        }
    })(request);
}
