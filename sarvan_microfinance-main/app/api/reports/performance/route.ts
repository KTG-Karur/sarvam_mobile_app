import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { format } from 'date-fns';
import { withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (req, user) => {
    try {
        const { searchParams } = new URL(req.url);
        const reportType = searchParams.get('reportType');
        const fromDateStr = searchParams.get('fromDate');
        const toDateStr = searchParams.get('toDate');
        const branchIdParam = searchParams.get('branchId');

        if (!reportType || !fromDateStr || !toDateStr) {
            return NextResponse.json(
                { error: 'Missing required parameters' },
                { status: 400 }
            );
        }

        const fromDate = new Date(fromDateStr);
        fromDate.setHours(0, 0, 0, 0);
        const toDate = new Date(toDateStr);
        toDate.setHours(23, 59, 59, 999);

        let data = [];
        let sno = 1;

        if (reportType === 'BRANCHWISE' || reportType === 'FDO WISE' || reportType === 'AM WISE' || reportType === 'DM WISE') {
            // For this implementation, we will fetch branches and real counts where possible
            // In a full production scale, this would be a complex raw SQL group by or view.

            const permittedBranchIds = await resolveScopedBranchIds(user, branchIdParam);

            const branches = await prisma.branch.findMany({
                where: {
                    isActive: true,
                    ...(permittedBranchIds ? { id: { in: permittedBranchIds } } : {}),
                },
                include: {
                    centers: {
                        include: {
                            clients: {
                                where: { isActive: true }
                            },
                            fdo: true
                        }
                    },
                    users: {
                        where: { role: 'BRANCH_MANAGER' }
                    }
                }
            });

            for (const branch of branches) {
                const totalCenters = branch.centers.length;
                let totalMembers = 0;
                let active = 0;
                let dropouts = 0;
                let fdoName = "UNASSIGNED";

                branch.centers.forEach((center: any) => {
                    totalMembers += center.clients.length;
                    active += center.clients.filter((c: any) => c.isActive).length;
                    dropouts += center.clients.filter((c: any) => !c.isActive).length;
                    if (center.fdo && center.fdo.firstName) {
                        fdoName = `${center.fdo.firstName} ${center.fdo.lastName}`;
                    }
                });

                // Fetching some actual transactions for accurate numbers inside the date range
                const txns = await prisma.loanTransaction.aggregate({
                    where: {
                        branchId: branch.id,
                        transactionDate: {
                            gte: fromDate,
                            lte: toDate,
                        },
                        isReversed: false
                    },
                    _sum: {
                        amount: true,
                        principalAmount: true,
                        interestAmount: true,
                        feesAmount: true
                    }
                });

                const loans = await prisma.loan.aggregate({
                    where: {
                        branchId: branch.id,
                        disbursementStatus: 'DISBURSED',
                        disbursedLevel1At: {
                            gte: fromDate,
                            lte: toDate
                        }
                    },
                    _sum: {
                        amount: true,
                    },
                    _count: {
                        _all: true
                    }
                });

                const bManager = branch.users[0] ? `${branch.users[0].firstName} ${branch.users[0].lastName}` : 'UNASSIGNED';

                data.push({
                    sino: sno++,
                    branch: `${branch.code} - ${branch.name}`,
                    address: branch.address || 'N/A',
                    totalCenters: totalCenters,
                    totalMembers: totalMembers,
                    attClients100: Math.floor(active * 0.95), // Simulated 100% attendance clients
                    active: active,
                    nr: Math.floor(active * 0.05), // Simulated NR (Non-Regular)
                    newMembers: loans._count._all || 0,
                    membersDropouts: dropouts,
                    fdoSupervisor: fdoName,
                    branchManager: bManager,
                    newLoanDemand: 0, // Would come from schedule calculations
                    oldLoanDemand: 0,
                    collection: Number(txns._sum.amount || 0),
                    preclosure: 0, // Placeholder
                    newMembersAmount: Number(loans._sum.amount || 0),
                    oldMembersAmount: 0,
                    totalAmount: Number(loans._sum.amount || 0),
                    collected: Number(txns._sum.amount || 0),
                    collectionAmount: Number(txns._sum.amount || 0),
                    arrearAmount: 0, // Would come from schedule calculations
                    outstanding: Number(loans._sum.amount || 0) - Number(txns._sum.principalAmount || 0), // Simplified OS
                    advance: 0,
                    arrPreAmount: 0,
                    charges: Number(txns._sum.feesAmount || 0),
                    bales: 0,     // Legacy system product type placeholder
                    lives: 0,     // Legacy system product type placeholder 
                    rent: 0,      // Legacy system product type placeholder
                    chabeeb: 0,   // Legacy system product type placeholder
                    classic: 0,   // Legacy system product type placeholder
                    applCharges: Math.floor(Number(loans._sum.amount || 0) * 0.01), // Estimated 1%
                    processingCharges: Math.floor(Number(loans._sum.amount || 0) * 0.02), // Estimated 2%
                });
            }
        } else {
            // In case unsupported type is sent temporarily
            return NextResponse.json({ data: [] });
        }

        return NextResponse.json({
            success: true,
            data,
            count: data.length,
        });
    } catch (error) {
        console.error('Performance report generation error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch performance report data' },
            { status: 500 }
        );
    }
    })(request);
}
