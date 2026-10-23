import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { format } from 'date-fns';
import { withRole } from '@/app/lib/api-utils';
import { buildBranchWhereClause } from '@/app/lib/permissions/branch-scope';

export async function GET(req: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (request, user) => {
    try {
        const searchParams = request.nextUrl.searchParams;
        const fromDateStr = searchParams.get('fromDate');
        const toDateStr = searchParams.get('toDate');
        const centerId = searchParams.get('centerId');
        const branchIdParam = searchParams.get('branchId');

        if (!fromDateStr || !toDateStr) {
            return NextResponse.json(
                { error: 'fromDate and toDate are required' },
                { status: 400 }
            );
        }

        const startDate = new Date(fromDateStr);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(toDateStr);
        endDate.setHours(23, 59, 59, 999);

        const branchWhere = await buildBranchWhereClause(user, branchIdParam);

        // Build where clause
        const whereClause: any = {
            disbursementStatus: { in: ['DISBURSED', 'APPROVED_LEVEL1'] },
            disbursedLevel1At: {
                gte: startDate,
                lte: endDate,
            },
            isActive: true,
            ...branchWhere,
        };

        // Add center filter if provided
        if (centerId && centerId !== 'all') {
            whereClause.centerId = centerId;
        }

        // Fetch loans disbursed within the date range
        const loans = await prisma.loan.findMany({
            where: whereClause,
            include: {
                client: true,
                center: {
                    include: {
                        branch: true,
                        fdo: true,
                    },
                },
                loanProduct: true,
                loanPurpose: { // Add loanPurpose relation
                    select: {
                        id: true,
                        name: true,
                        loanPurposeType: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                },
                schedules: {
                    orderBy: {
                        installmentNo: 'asc',
                    },
                },
                createdBy: true,
            },
            orderBy: {
                disbursedLevel1At: 'asc',
            },
        });

        // Format data to match the DisbursementData interface expected by the frontend
        const data = loans.map((loan, index) => {
            const disbursalDate = loan.disbursedLevel1At
                ? format(new Date(loan.disbursedLevel1At), 'dd/MM/yyyy')
                : 'N/A';

            const dueStartDate = loan.schedules.length > 0
                ? format(new Date(loan.schedules[0].dueDate), 'dd/MM/yyyy')
                : 'N/A';

            const loanEndDate = loan.schedules.length > 0
                ? format(new Date(loan.schedules[loan.schedules.length - 1].dueDate), 'dd/MM/yyyy')
                : 'N/A';

            // Determine purpose: use loanPurpose name, fallback to loanProduct name or 'N/A'
            let purposeValue = 'N/A';
            if (loan.loanPurpose?.name) {
                purposeValue = loan.loanPurpose.name;
                // Optionally include the purpose type in parentheses
                if (loan.loanPurpose.loanPurposeType?.name) {
                    purposeValue = `${loan.loanPurpose.name} (${loan.loanPurpose.loanPurposeType.name})`;
                }
            } else if (loan.loanProduct?.productName) {
                purposeValue = loan.loanProduct.productName;
            }

            return {
                branchId: loan.center?.branch?.code || 'N/A',
                branchName: loan.center?.branch?.name || 'N/A',
                disbursalDate: disbursalDate,
                centerId: loan.center?.code || 'N/A',
                centerName: loan.center?.name || 'N/A',
                memberId: loan.client?.clientId || 'N/A',
                memberName: `${loan.client?.firstName || ''} ${loan.client?.lastName || ''}`.trim(),
                funder: 'OWN FUND',
                loanAccountNo: loan.loanNumber || 'N/A',
                loanAmount: Number(loan.amount || 0),
                totalDues: loan.tenureMonths || 0,
                purpose: purposeValue, // Updated to use loanPurpose name
                empId: loan.center?.fdo?.id || loan.createdBy?.id || 'N/A',
                fdo: loan.center?.fdo
                    ? `${loan.center.fdo.firstName} ${loan.center.fdo.lastName}`.trim()
                    : (loan.createdBy ? `${loan.createdBy.firstName} ${loan.createdBy.lastName}`.trim() : 'Unassigned'),
                dueStartDate: dueStartDate,
                loanEndDate: loanEndDate,
                loanSlNo: index + 1,
                phone: loan.client?.phone || loan.client?.mobileNumber || 'N/A',
                meetingDay: loan.center?.meetingDay || 'N/A',
            };
        });

        return NextResponse.json({
            success: true,
            data,
            count: data.length,
        });
    } catch (error) {
        console.error('Error fetching disbursement report details:', error);
        return NextResponse.json(
            {
                error: 'Failed to fetch disbursement report details',
                details: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
    })(req);
}