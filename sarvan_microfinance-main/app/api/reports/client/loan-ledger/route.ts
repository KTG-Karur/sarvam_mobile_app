import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { startOfDay, endOfDay } from 'date-fns';
import { withRole } from '@/app/lib/api-utils';
import { assertFdoOwnsCenter } from '@/app/lib/filters/fdo-center-scope';
import { isAmAssignedToBranch } from '@/app/lib/am-branch-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function GET(req: NextRequest) {
    return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO'], async (request, user) => {
        try {
        const searchParams = request.nextUrl.searchParams;
        const centerId = searchParams.get('centerId');
        const clientId = searchParams.get('clientId');
        const loanId = searchParams.get('loanId');

        if (!centerId || !clientId) {
            return NextResponse.json(
                { error: 'Center and Client are required' },
                { status: 400 }
            );
        }

        const center = await prisma.center.findUnique({
            where: { id: centerId },
            select: {
                id: true,
                branchId: true,
                fdoId: true,
            },
        });

        if (!center) {
            return NextResponse.json({ error: 'Center not found' }, { status: 404 });
        }

        // Enforce role-based center access for robust API-level security.
        if (!assertFdoOwnsCenter(user, center)) {
            return NextResponse.json({ error: 'Unauthorized center access' }, { status: 403 });
        }

        if (user.role === 'BRANCH_MANAGER') {
            const permittedBranchIds = await getPermittedBranchIds(user);
            if (permittedBranchIds !== null && !permittedBranchIds.includes(center.branchId)) {
                return NextResponse.json({ error: 'Unauthorized center access' }, { status: 403 });
            }
        }

        // ADMIN has unrestricted access. AREA_MANAGER is scoped to their assigned branches
        // (AreaManagerBranch), not just the currently-active branch — an AM managing multiple
        // branches must be able to open a ledger for any branch they're assigned to, regardless
        // of which one is currently active in the branch switcher.
        if (user.role === 'AREA_MANAGER' && !(await isAmAssignedToBranch(user.userId, center.branchId))) {
            return NextResponse.json({ error: 'Unauthorized center access' }, { status: 403 });
        }

        // Let's get the client with their loans
        const client = await prisma.client.findUnique({
            where: { id: clientId },
            include: {
                loanApplications: {
                    where: loanId ? { id: loanId } : undefined,
                    orderBy: { createdAt: 'desc' },
                    include: {
                        loanProduct: true,
                        transactions: {
                            where: {
                                isReversed: false,
                            },
                            orderBy: {
                                transactionDate: 'asc',
                            },
                        },
                        deathMarking: { where: { isReversed: false } },
                        schedules: {
                            orderBy: {
                                installmentNo: 'desc',
                            },
                            take: 1,
                        },
                    },
                },
                center: true,
            },
        });

        if (!client) {
            return NextResponse.json({ error: 'Client not found' }, { status: 404 });
        }

        if (client.centerId !== centerId) {
            return NextResponse.json({ error: 'Client does not belong to the selected center' }, { status: 400 });
        }

        let allTransactions: any[] = [];
        const specificLoan = client.loanApplications[0] || null;
        const specificLoanData = specificLoan
            ? {
                loanAc: specificLoan.loanNumber,
                loanStatus: specificLoan.closedDate ? 'CLOSED' : 'OPEN',
                productName: specificLoan.loanProduct?.productName || 'N/A',
                disbursedAmount: Number(specificLoan.amount || 0),
                disbursedDate: specificLoan.disbursedByBMAt
                    ? new Date(specificLoan.disbursedByBMAt).toISOString()
                    : (specificLoan.disbursedLevel1At ? new Date(specificLoan.disbursedLevel1At).toISOString() : null),
                loanEndDate: specificLoan.schedules?.[0]?.dueDate?.toISOString() ?? null,
                interestRate: Number(specificLoan.interestRate || 0),
                tenure: `${specificLoan.tenureMonths} Months`,
                outstandingBalance: Math.max(0, Number(specificLoan.amount || 0) - Number(specificLoan.principalPaid || 0)),
                isDead: (specificLoan as any).deathMarking?.length > 0,
                deathMarking: (specificLoan as any).deathMarking?.[0]
                    ? {
                        deceasedPersonType: (specificLoan as any).deathMarking[0].deceasedPersonType,
                        deceasedPersonName: (specificLoan as any).deathMarking[0].deceasedPersonName,
                        deathDate: (specificLoan as any).deathMarking[0].deathDate,
                        placeOfDeath: (specificLoan as any).deathMarking[0].placeOfDeath,
                        deathReason: (specificLoan as any).deathMarking[0].deathReason,
                        demandRequired: (specificLoan as any).deathMarking[0].demandRequired,
                      }
                    : null,
            }
            : null;

        for (const loan of client.loanApplications) {
            // Get opening balance transactions
            const allTransactionsForLoan = await prisma.loanTransaction.findMany({
                where: {
                    loanId: loan.id,
                    isReversed: false,
                },
                orderBy: {
                    transactionDate: 'asc',
                },
            });

            let currentBalance = 0;

            allTransactionsForLoan.forEach(t => {
                if (t.type === 'DISBURSEMENT') {
                    currentBalance += Number(t.principalAmount || t.amount || 0);
                } else if (['REPAYMENT', 'PRECLOSURE'].includes(t.type)) {
                    currentBalance -= Number(t.principalAmount || 0);
                }

                const isSavings = (t.type as string) === 'SAVINGS_COLLECTION';

                allTransactions.push({
                    isOpeningBalance: false,
                    date: t.transactionDate.toISOString(),
                    transactionId: t.transactionId,
                    type: t.type,
                    description: t.description || t.remarks || (isSavings ? 'Loan Advance Collection' : t.type),
                    paymentMode: t.paymentMode,
                    loanAc: loan.loanNumber,
                    productName: loan.loanProduct?.productName || 'N/A',
                    principal: t.type === 'DISBURSEMENT' || isSavings ? 0 : Number(t.principalAmount || 0),
                    disbursementAmount: t.type === 'DISBURSEMENT' ? Number(t.amount || 0) : 0,
                    interest: isSavings ? 0 : Number(t.interestAmount || 0),
                    fee: isSavings ? 0 : Number(t.feesAmount || 0) + Number(t.penaltyAmount || 0),
                    savings: isSavings ? Number(t.amount || 0) : 0,
                    total: Number(t.amount || 0),
                    balance: currentBalance,
                    status: t.status,
                });
            });
        }

        return NextResponse.json({
            clientDetails: {
                clientId: client.clientId,
                clientName: `${client.firstName} ${client.lastName}`.trim(),
                centerName: client.center?.name,
                centerCode: client.center?.code,
            },
            loanDetails: specificLoanData,
            ledger: allTransactions,
        });

        } catch (error) {
            console.error('Error fetching loan ledger:', error);
            return NextResponse.json(
                { error: 'Failed to fetch loan ledger' },
                { status: 500 }
            );
        }
    })(req);
}