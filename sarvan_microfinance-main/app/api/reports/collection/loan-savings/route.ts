import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

type LoanAdvanceRow = {
    clientCode: string;
    regionName: string;
    divisionName: string;
    areaName: string;
    branchCode: string;
    branchName: string;
    centreCode: string;
    centerName: string;
    fdoName: string;
    memberId: string;
    memberName: string;
    nomineeName: string;
    phoneNumber: string;
    aadhaarNumber: string;
    loanAdvanceOS: number;
};

type Totals = {
    clientCount: number;
    totalLoanAdvanceOS: number;
};

export async function GET(req: NextRequest) {
    return withRole(
        ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
        async (request, user) => {
            const { searchParams } = new URL(request.url);
            const branchId = searchParams.get('branchId');
            const centerId = searchParams.get('centerId');

            const clientWhere: {
                isActive: boolean;
                loanAdvance: { gt: number };
                center?: { branchId: string | { in: string[] } };
                centerId?: string;
            } = {
                isActive: true,
                loanAdvance: { gt: 0 },
            };

            // Role-based branch scoping — fails safe: a client-supplied branchId
            // outside the caller's permitted set is ignored, never honored.
            const scopedBranchIds = await resolveScopedBranchIds(user, branchId);
            if (scopedBranchIds !== null) {
                clientWhere.center = {
                    branchId: scopedBranchIds.length === 1 ? scopedBranchIds[0] : { in: scopedBranchIds },
                };
            }

            if (centerId && centerId !== 'all') {
                clientWhere.centerId = centerId;
            }

            const clients = await prisma.client.findMany({
                where: clientWhere,
                select: {
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    mobileNumber: true,
                    otherIdNo: true,
                    nomineeName: true,
                    loanAdvance: true,
                    center: {
                        include: {
                            branch: {
                                include: {
                                    areas: {
                                        include: {
                                            division: { include: { region: true } },
                                        },
                                    },
                                },
                            },
                            fdo: true,
                        },
                    },
                },
                orderBy: [{ center: { name: 'asc' } }, { firstName: 'asc' }],
            });

            const rows: LoanAdvanceRow[] = clients.map(c => ({
                clientCode:    c.clientId,
                regionName:    c.center?.branch?.areas?.[0]?.division?.region?.name ?? 'N/A',
                divisionName:  c.center?.branch?.areas?.[0]?.division?.name         ?? 'N/A',
                areaName:      c.center?.branch?.areas?.[0]?.name                   ?? 'N/A',
                branchCode:    c.center?.branch?.code                               ?? 'N/A',
                branchName:    c.center?.branch?.name                               ?? 'N/A',
                centreCode:    c.center?.code                                        ?? 'N/A',
                centerName:    c.center?.name                                        ?? 'N/A',
                fdoName:       c.center?.fdo
                                   ? `${c.center.fdo.firstName} ${c.center.fdo.lastName}`.trim()
                                   : 'N/A',
                memberId:      c.clientId,
                memberName:    `${c.firstName} ${c.lastName}`.trim(),
                nomineeName:   c.nomineeName ?? '',
                phoneNumber:   c.phone || c.mobileNumber || 'N/A',
                aadhaarNumber: c.otherIdNo || 'N/A',
                loanAdvanceOS: Number(c.loanAdvance ?? 0),
            }));

            const totals: Totals = {
                clientCount:        rows.length,
                totalLoanAdvanceOS: rows.reduce((s, r) => s + r.loanAdvanceOS, 0),
            };

            return NextResponse.json({ success: true, data: rows, totals, count: rows.length });
        }
    )(req);
}
