// app/lib/services/ongoing-loans.service.ts
import { prisma } from '@/app/lib/prisma';

export type OngoingLoan = {
    id: string;
    loanNumber: string;
    productName: string;
    indexNo: string | null;
    disbursementDate: string;
    loanAmount: number;
    outstandingPrincipal: number;
    outstandingInterest: number;
    arrear: number;
    status: string;
};

/**
 * Fetches ongoing (disbursed or still-active-in-an-index) loans for a batch of clients
 * in a single query, keyed by clientId. Used instead of firing one request per client,
 * which under a large "select all" batch made partial/silent per-request failures likely.
 */
export async function getOngoingLoansByClientIds(
    clientIds: string[]
): Promise<Record<string, OngoingLoan[]>> {
    const result: Record<string, OngoingLoan[]> = {};
    if (clientIds.length === 0) return result;

    const loans = await prisma.loan.findMany({
        where: {
            clientId: { in: clientIds },
            isActive: true,
            disbursementStatus: { not: 'REJECTED' },
            OR: [
                { disbursementStatus: 'DISBURSED' },
                {
                    indexId: { not: null },
                    loanIndex: { isActive: true },
                },
            ],
        },
        select: {
            id: true,
            clientId: true,
            loanNumber: true,
            amount: true,
            principalPaid: true,
            disbursedByBMAt: true,
            disbursedLevel1At: true,
            disbursementStatus: true,
            createdAt: true,
            loanProduct: {
                select: {
                    productName: true,
                },
            },
            loanIndex: {
                select: {
                    indexNo: true,
                },
            },
            schedules: {
                select: {
                    interestDue: true,
                    interestPaid: true,
                    status: true,
                    dueDate: true,
                    principalDue: true,
                    principalPaid: true,
                },
            },
        },
        orderBy: {
            createdAt: 'desc',
        },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const loan of loans) {
        const disbursementDate = loan.disbursedByBMAt || loan.disbursedLevel1At || new Date();
        const day = disbursementDate.getDate().toString().padStart(2, '0');
        const month = (disbursementDate.getMonth() + 1).toString().padStart(2, '0');
        const year = disbursementDate.getFullYear();
        const disbursementDateFormatted = `${day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][disbursementDate.getMonth()]} ${year}`;

        const outstandingPrincipal = Number(loan.amount) - Number(loan.principalPaid);

        const outstandingInterest = loan.schedules.reduce((sum, schedule) => {
            if (schedule.status !== 'PAID') {
                return sum + (Number(schedule.interestDue) - Number(schedule.interestPaid));
            }
            return sum;
        }, 0);

        const arrear = loan.schedules.reduce((sum, schedule) => {
            if (schedule.status !== 'PAID' && schedule.status !== 'WAIVED' && new Date(schedule.dueDate) < today) {
                return sum + Math.max(0,
                    Number(schedule.principalDue) + Number(schedule.interestDue)
                    - Number(schedule.principalPaid) - Number(schedule.interestPaid)
                );
            }
            return sum;
        }, 0);

        const formatted: OngoingLoan = {
            id: loan.id,
            loanNumber: loan.loanNumber,
            productName: loan.loanProduct?.productName || '—',
            indexNo: loan.loanIndex?.indexNo || null,
            disbursementDate: disbursementDateFormatted,
            loanAmount: Number(loan.amount),
            outstandingPrincipal,
            outstandingInterest,
            arrear,
            status: loan.disbursementStatus,
        };

        if (!result[loan.clientId]) result[loan.clientId] = [];
        result[loan.clientId].push(formatted);
    }

    return result;
}
